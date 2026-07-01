chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "processCSV") {
        // 立即返回，表示我们会异步处理
        sendResponse({ received: true });

        // 异步处理逻辑
        (async () => {
            try {
                await processChannels(request.data);
                // 处理完成后，使用新的消息通知 popup
                chrome.runtime.sendMessage({
                    action: "processComplete",
                    success: true
                });
            } catch (error) {
                console.error('Error:', error);
                chrome.runtime.sendMessage({
                    action: "processComplete",
                    success: false,
                    error: error.message
                });
            }
        })();
        return true; // 保持消息通道开启
    }

    if (request.action === "keepAlive") {
        sendResponse({ status: "alive" });
        return true;
    }
    if (request.action === "processAllPlaylists") {
        // Return immediately so the popup is not tied to a long MV3 message port.
        sendResponse({ received: true });

        processAllPlaylists(request.playlists).then(() => {
            chrome.runtime.sendMessage({
                action: "playlistsCompleted"
            }).catch(() => {
                console.log('Popup may be closed, cannot send playlist completion message');
            });
        }).catch(error => {
            console.error('Error processing playlists:', error);
            chrome.runtime.sendMessage({
                action: "playlistsError",
                error: error.message
            }).catch(() => {
                console.log('Popup may be closed, cannot send playlist error message');
            });
        });
        return true;
    }
    if (request.action === "keepAlive") {
        sendResponse({ status: "alive" });
        return true;
    }
});

// 添加一个辅助函数来安全地发送消息到 popup
async function sendMessageToPopup(message) {
    try {
        // 检查 popup 是否打开
        const views = chrome.extension.getViews({ type: "popup" });
        if (views.length > 0) {
            await chrome.runtime.sendMessage(message);
        }
    } catch (error) {
        console.log('Popup may be closed, cannot send message');
    }
}

// 处理频道的函数
async function processChannels(data) {
    const channels = CSVToArray(data);
    console.log('All channels turned to array');
    let totalProcessed = 0;

    try {
        // 跳过标题行，从第二行开始处理
        for (let i = 1; i < channels.length; i++) {
            const channelUrl = channels[i][1];
            const channelTitle = channels[i][2];

            if (!channelUrl || !channelTitle) {
                console.log(`跳过无效数据行 ${i}`);
                continue;
            }

            console.log(`Processing channel ${i}/${channels.length - 1}: ${channelTitle}`);

            await new Promise((resolve, reject) => {
                chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
                    const currentTab = tabs[0];

                    // 更新标签页到频道URL
                    chrome.tabs.update(currentTab.id, { url: channelUrl }, function () {
                        // 等待页面完全加载
                        const listener = function (tabId, changeInfo) {
                            if (tabId === currentTab.id && changeInfo.status === 'complete') {
                                chrome.tabs.onUpdated.removeListener(listener);

                                // 确保 content script 已经注入并准备就绪
                                const retryMessageSend = (retryCount = 0) => {
                                    setTimeout(() => {
                                        chrome.tabs.sendMessage(currentTab.id, {
                                            action: "subscribeToChannel",
                                            channelUrl,
                                            channelTitle
                                        }, response => {
                                            if (chrome.runtime.lastError) {
                                                console.log('重试发送消息:', retryCount);
                                                if (retryCount < 3) {
                                                    retryMessageSend(retryCount + 1);
                                                } else {
                                                    console.error('发送消息失败:', chrome.runtime.lastError);
                                                    resolve(); // 继续处理下一个频道
                                                }
                                                return;
                                            }

                                            if (response && response.status === "success") {
                                                console.log(`Successfully subscribed to ${channelTitle}`);
                                                totalProcessed++;
                                            }
                                            resolve();
                                        });
                                    }, retryCount === 0 ? 2000 : 1000); // 首次等待更长时间
                                };

                                retryMessageSend();
                            }
                        };
                        chrome.tabs.onUpdated.addListener(listener);
                    });
                });
            });
            // 发送进度更新
            await sendMessageToPopup({
                action: "updateProgress",
                type: "channels",
                progress: Math.round((i / (channels.length - 1)) * 100)
            });
        }
        // 处理完成后发送完成消息
        await sendMessageToPopup({
            action: "processComplete",
            success: true
        });

        // 所有频道处理完成后，跳转到完成页面
        return new Promise((resolve) => {
            chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
                const currentTab = tabs[0];
                chrome.tabs.update(currentTab.id, {
                    url: chrome.runtime.getURL('completion.html')
                }, () => {
                    resolve({ success: true });
                });
            });
        });

    } catch (error) {
        console.error('Error processing channels:', error);
        throw error;
    }
}
// CSV解析函数
function CSVToArray(strData, strDelimiter) {
    strDelimiter = (strDelimiter || ",");
    const objPattern = new RegExp(
        ("(\\" + strDelimiter + "|\\r?\\n|\\r|^)" +
            "(?:\"([^\"]*(?:\"\"[^\"]*)*)\"|" +
            "([^\"\\" + strDelimiter + "\\r\\n]*))"),
        "gi"
    );
    const arrData = [[]];
    let arrMatches = null;

    while (arrMatches = objPattern.exec(strData)) {
        const strMatchedDelimiter = arrMatches[1];
        if (strMatchedDelimiter.length && strMatchedDelimiter !== strDelimiter) {
            arrData.push([]);
        }
        let strMatchedValue;
        if (arrMatches[2]) {
            strMatchedValue = arrMatches[2].replace(
                new RegExp("\"\"", "g"),
                "\""
            );
        } else {
            strMatchedValue = arrMatches[3];
        }
        arrData[arrData.length - 1].push(strMatchedValue);
    }
    return arrData;
}

async function processAllPlaylists(playlists) {
    console.log(`开始处理 ${playlists.length} 个播放列表`);

    return new Promise((resolve, reject) => {
        chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
            const currentTab = tabs[0];
            let currentPlaylistIndex = 0;
            let currentVideoIndex = 0;
            let retryCount = 0;
            const MAX_RETRIES = 3;

            async function processNextVideo() {
                try {
                    const currentPlaylist = playlists[currentPlaylistIndex];
                    const videos = currentPlaylist?.videos || [];

                    // 检查是否所有播放列表都处理完成
                    if (currentPlaylistIndex >= playlists.length || !currentPlaylist) {
                        console.log('所有播放列表处理完成');

                        // 跳转到完成页面
                        chrome.tabs.update(currentTab.id, {
                            url: chrome.runtime.getURL('completion.html')
                        });
                        resolve();
                        return;
                    }

                    // 检查当前播放列表是否处理完成
                    if (currentVideoIndex >= videos.length) {
                        console.log(`播放列表 ${currentPlaylist.name} 处理完成`);
                        currentPlaylistIndex++;
                        currentVideoIndex = 0;
                        setTimeout(processNextVideo, 2000);
                        return;
                    }

                    const videoId = videos[currentVideoIndex];
                    console.log(`处理播放列表 ${currentPlaylist.name} 的第 ${currentVideoIndex + 1}/${videos.length} 个视频: ${videoId}`);

                    await new Promise((resolveVideo) => {
                        const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
                        chrome.tabs.update(currentTab.id, { url: videoUrl }, function () {
                            function onTabUpdated(tabId, changeInfo) {
                                if (tabId === currentTab.id && changeInfo.status === 'complete') {
                                    chrome.tabs.onUpdated.removeListener(onTabUpdated);
                                    setTimeout(() => {
                                        chrome.tabs.sendMessage(currentTab.id, {
                                            action: "createPlaylist",
                                            name: currentPlaylist.name,
                                            currentVideo: videoId
                                        }, (response) => {
                                            if (chrome.runtime.lastError || !response) {
                                                retryCount++;
                                                if (retryCount < MAX_RETRIES) {
                                                    setTimeout(processNextVideo, 2000);
                                                } else {
                                                    console.log(`跳过视频 ${videoId} 并继续处理下一个`);
                                                    currentVideoIndex++;
                                                    retryCount = 0;
                                                    setTimeout(processNextVideo, 2000);
                                                }
                                                resolveVideo();
                                                return;
                                            }

                                            // 无论成功失败都继续处理下一个视频
                                            currentVideoIndex++;
                                            retryCount = 0;
                                            setTimeout(processNextVideo, 2000);
                                            resolveVideo();
                                        });
                                    }, 2000);
                                }
                            }
                            chrome.tabs.onUpdated.addListener(onTabUpdated);
                        });
                    });
                } catch (error) {
                    console.error('处理视频时发生错误:', error);
                    // 跳转到完成页面，但显示错误信息
                    chrome.tabs.update(currentTab.id, {
                        url: chrome.runtime.getURL('completion.html') + '?error=' + encodeURIComponent(error.message)
                    });
                    resolve();
                }
            }

            processNextVideo();
        });
    });
}



// 处理来自 popup 的消息
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "processPlaylist") {
        processPlaylist(request.name, request.data, request.isLastFile).then(() => {
            sendResponse({ success: true });
        }).catch(error => {
            console.error('Error processing playlist:', error);
            sendResponse({ success: false, error: error.message });
        });
        return true;
    } else if (request.action === "keepAlive") {
        sendResponse({ status: "alive" });
        return true;
    }
});
