chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "processCSV") {
        // Respond immediately; processing is async
        sendResponse({ received: true });

        // Async processing logic
        (async () => {
            try {
                await processChannels(request.data);
                // Notify the popup when processing finishes
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
        return true; // keep the message channel open
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

// Helper to safely send messages to the popup (also broadcasts to content scripts).
// Cannot rely on chrome.extension.getViews to detect an open popup: it is unreliable under MV3,
// and the popup closes automatically when the user clicks the tab. Broadcast directly and swallow errors.
async function sendMessageToPopup(message) {
    try {
        await chrome.runtime.sendMessage(message);
    } catch (error) {
        console.log('Popup may be closed, cannot send message');
    }
}

// Process channel subscriptions from the CSV
async function processChannels(data) {
    const channels = CSVToArray(data);
    console.log('All channels turned to array');
    let totalProcessed = 0;
    let processedCount = 0;

    // Count valid channels (skip header and invalid rows) for the progress indicator (e.g. "3/56 Subscribed")
    const totalChannels = channels.slice(1).filter(row => row[1] && row[2]).length;

    try {
        // Skip the header row; start from the second row
        for (let i = 1; i < channels.length; i++) {
            const channelUrl = channels[i][1];
            const channelTitle = channels[i][2];

            if (!channelUrl || !channelTitle) {
                console.log(`Skipping invalid data row ${i}`);
                continue;
            }
            processedCount++;

            console.log(`Processing channel ${i}/${channels.length - 1}: ${channelTitle}`);

            await new Promise((resolve, reject) => {
                chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
                    const currentTab = tabs[0];

                    // Navigate the tab to the channel URL
                    chrome.tabs.update(currentTab.id, { url: channelUrl }, function () {
                        // Wait for the page to fully load
                        const listener = function (tabId, changeInfo) {
                            if (tabId === currentTab.id && changeInfo.status === 'complete') {
                                chrome.tabs.onUpdated.removeListener(listener);

                                // Make sure the content script is injected and ready
                                const retryMessageSend = (retryCount = 0) => {
                                    setTimeout(() => {
                                        chrome.tabs.sendMessage(currentTab.id, {
                                            action: "subscribeToChannel",
                                            channelUrl,
                                            channelTitle
                                        }, response => {
                                            if (chrome.runtime.lastError) {
                                                console.log('Retrying message send:', retryCount);
                                                if (retryCount < 3) {
                                                    retryMessageSend(retryCount + 1);
                                                } else {
                                                    console.error('Failed to send message:', chrome.runtime.lastError);
                                                    resolve(); // continue with the next channel
                                                }
                                                return;
                                            }

                                            if (response && response.status === "success") {
                                                console.log(`Successfully subscribed to ${channelTitle}`);
                                                totalProcessed++;
                                            }
                                            resolve();
                                        });
                                    }, retryCount === 0 ? 2000 : 1000); // longer initial wait
                                };

                                retryMessageSend();
                            }
                        };
                        chrome.tabs.onUpdated.addListener(listener);
                    });
                });
            });
            // Send progress update (the popup shows "Processing subscriptions (N/M)")
            await sendMessageToPopup({
                action: "updateProgress",
                type: "channels",
                progress: Math.round((processedCount / totalChannels) * 100),
                current: processedCount,
                total: totalChannels,
                subscribed: totalProcessed
            });
        }
        // Notify completion after all channels are done
        await sendMessageToPopup({
            action: "processComplete",
            success: true
        });

        // Navigate to the completion page after all channels are processed
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
// CSV parsing function
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
    console.log(`Processing ${playlists.length} playlists`);

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

                    // Check whether all playlists have been processed
                    if (currentPlaylistIndex >= playlists.length || !currentPlaylist) {
                        console.log('All playlists processed');

                        // Navigate to the completion page
                        chrome.tabs.update(currentTab.id, {
                            url: chrome.runtime.getURL('completion.html')
                        });
                        resolve();
                        return;
                    }

                    // Check whether the current playlist is done
                    if (currentVideoIndex >= videos.length) {
                        console.log(`Playlist ${currentPlaylist.name} processed`);
                        currentPlaylistIndex++;
                        currentVideoIndex = 0;
                        setTimeout(processNextVideo, 2000);
                        return;
                    }

                    const videoId = videos[currentVideoIndex];
                    console.log(`Processing playlist ${currentPlaylist.name}, video ${currentVideoIndex + 1}/${videos.length}: ${videoId}`);

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
                                                    console.log(`Skipping video ${videoId} and continuing`);
                                                    currentVideoIndex++;
                                                    retryCount = 0;
                                                    setTimeout(processNextVideo, 2000);
                                                }
                                                resolveVideo();
                                                return;
                                            }

                                            // Continue to the next video regardless of success or failure
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
                    console.error('Error processing video:', error);
                    // Navigate to the completion page, showing the error
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



// Handle messages from the popup
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
