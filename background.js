chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "processCSV") {
        processChannels(request.data).then(() => {
            sendResponse({ success: true }); // 处理完成
        }).catch(error => {
            console.error('Error processing channels:', error);
            sendResponse({ success: false, error: error.message });
        });
        return true; // 保持消息通道开启
    }
});

// 处理频道的函数
async function processChannels(data) {
    const channels = CSVToArray(data);
    console.log('All channels turned to array');
    
    for (let i = 1; i < channels.length; i++) {
        const channelUrl = channels[i][1];
        const channelTitle = channels[i][2];
        console.log(`Processing channel ${i}/${channels.length - 1}: ${channelTitle}`);

        // 在同一个标签页中打开频道 URL
        await new Promise(resolve => {
            chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
                const currentTab = tabs[0];
                // 更新当前活动标签页的 URL
                chrome.tabs.update(currentTab.id, { url: channelUrl }, function() {
                    // 等待标签页加载完成
                    chrome.tabs.onUpdated.addListener(function listener(tabId, changeInfo) {
                        if (tabId === currentTab.id && changeInfo.status === 'complete') {
                            // 发送消息到当前标签页
                            chrome.tabs.sendMessage(currentTab.id, { action: "subscribeToChannel", channelUrl, channelTitle }, (response) => {
                                if (response && response.status === "success") {
                                    console.log(`Successfully subscribed to ${channelTitle}`);
                                } else if (response && response.status === "error") {
                                    console.error(`Failed to subscribe to ${channelTitle}: ${response.error}`);
                                }
                                // 解除事件监听器
                                chrome.tabs.onUpdated.removeListener(listener);
                                resolve(); // 处理完成，继续下一个频道
                            });
                        }
                    });
                });
            });
        });
    }
    console.log('All channels processed');
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