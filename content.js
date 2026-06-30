let observer;

chrome.runtime.onMessage.addListener((request, _, sendResponse) => {
    if (request.action === "subscribeToChannel") {
        console.log('收到订阅请求:', request);

        // 执行订阅操作
        subscribeToChannel(request.channelUrl, request.channelTitle)
            .then(subscribed => {
                if (subscribed) {
                    sendResponse({ status: "success", message: "Successfully subscribed" });
                } else {
                    sendResponse({ status: "success", message: "Already subscribed" });
                }
            })
            .catch(error => {
                console.error('订阅失败:', error);
                sendResponse({ status: "error", message: error.message });
            });

        return true; // 保持消息通道开启
    }
    if (request.action === "processCSV") {
        // 创建一个新的 Promise 链来处理整个流程
        (async () => {
            try {
                await processChannels(request.data);
                // 在这里等待页面跳转完成
                await new Promise((resolve) => {
                    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
                        const currentTab = tabs[0];
                        chrome.tabs.update(currentTab.id, {
                            url: chrome.runtime.getURL('completion.html')
                        }, () => {
                            resolve();
                        });
                    });
                });
                sendResponse({ success: true });
            } catch (error) {
                console.error('Error processing channels:', error);
                // 发生错误时跳转到错误页面
                await new Promise((resolve) => {
                    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
                        const currentTab = tabs[0];
                        chrome.tabs.update(currentTab.id, {
                            url: chrome.runtime.getURL('completion.html') + '?error=' + encodeURIComponent(error.message)
                        }, () => {
                            resolve();
                        });
                    });
                });
                sendResponse({ success: false, error: error.message });
            }
        })();
        return true; // 保持消息通道开启
    }
    if (request.action === "createPlaylist") {
        (async () => {
            try {
                const result = await addVideoToPlaylist(request.currentVideo, request.name);
                console.log('视频处理结果:', result);
                sendResponse(result);
            } catch (error) {
                console.error('处理播放列表失败:', error);
                sendResponse({ status: "continue", error: error.message });
            }
        })();
        return true;
    }
});

// 等待页面加载某个元素，添加重试机制
const waitForElement = (selector, timeout = 5000, parent = document) => {
    return new Promise((resolve, reject) => {
        const startTime = Date.now();

        const checkElement = () => {
            const element = parent.querySelector(selector);
            if (element) {
                resolve(element);
            } else if (Date.now() - startTime > timeout) {
                reject(new Error(`元素 ${selector} 在 ${timeout}ms 内未找到`));
            } else {
                setTimeout(checkElement, 100);
            }
        };
        checkElement();
    });
};

// 订阅频道
const subscribeToChannel = async (channelUrl, channelTitle) => {
    console.log(`尝试订阅频道: ${channelTitle} (${channelUrl})`);

    try {
        // 等待页面加载完成
        await new Promise(r => setTimeout(r, 500)); // 额外等待时间确保 YouTube 动态内容加载

        // 尝试多个可能的订阅按钮选择器
        const buttonSelectors = [
            'button[aria-label^="订阅"]',
            'button[aria-label^="Subscribe"]',
            '#subscribe-button button',
            'ytd-subscribe-button-renderer button',
            '#subscribe-button ytd-subscribe-button-renderer button'
        ];

        let subscribeButton = null;
        for (const selector of buttonSelectors) {
            try {
                subscribeButton = await waitForElement(selector, 200);
                if (subscribeButton) break;
            } catch (e) {
                console.log(`未找到选择器 ${selector} 的按钮，尝试下一个...`);
            }
        }

        if (!subscribeButton) {
            throw new Error('未找到订阅按钮');
        }

        console.log('找到订阅按钮:', subscribeButton);

        // 检查按钮状态
        const buttonText = subscribeButton.textContent.trim().toLowerCase();
        const ariaLabel = subscribeButton.getAttribute('aria-label')?.toLowerCase() || '';
        
        const isSubscribed = 
            buttonText.includes('已订阅') || 
            buttonText.includes('subscribed') ||
            ariaLabel.includes('取消订阅') ||
            ariaLabel.includes('unsubscribe');

        if (!isSubscribed) {
            // 点击订阅按钮
            subscribeButton.click();
            console.log('已点击订阅按钮');

            // 等待订阅状态更新
            await new Promise(r => setTimeout(r, 200));
            
            // 验证订阅是否成功
            const newButtonText = subscribeButton.textContent.trim().toLowerCase();
            const newAriaLabel = subscribeButton.getAttribute('aria-label')?.toLowerCase() || '';
            const subscribeSuccess = 
                newButtonText.includes('已订阅') || 
                newButtonText.includes('subscribed') ||
                newAriaLabel.includes('取消订阅') ||
                newAriaLabel.includes('unsubscribe');
                
            if (!subscribeSuccess) {
                throw new Error('订阅操作未成功完成');
            }
            
            return true;
        } else {
            console.log('频道已经被订阅，无需操作');
            return false;
        }
    } catch (error) {
        console.error('订阅过程中发生错误:', error);
        throw error; // 正确抛出错误
    }
};

async function isVideoAvailable() {
    try {
        const videoId = new URL(window.location.href).searchParams.get('v');
        if (!videoId) return false;

        const response = await fetch(`https://img.youtube.com/vi/${videoId}/default.jpg`);
        if (!response.ok) {
            console.log(`视频 ${videoId} 的缩略图不存在，视频可能已失效`);
            return false;
        }

        return true;
    } catch (error) {
        console.log(`检查视频缩略图失败:`, error);
        return false;
    }
}

// 等待页面加载完成
const waitForPageLoad = () => {
    return new Promise((resolve) => {
        if (document.readyState === 'complete') {
            resolve();
        } else {
            window.addEventListener('load', () => {
                resolve();
            });
        }
    });
};

async function addVideoToPlaylist(videoId, playlistName) {
    try {
        // 确保页面完全加载
        await waitForPageLoad();

        // 等待更长时间以确保错误信息和视频信息完全加载
        await new Promise(r => setTimeout(r, 3000));

        // 检查视频是否可用
        if (!await isVideoAvailable()) {
            console.log(`视频 ${videoId} 不可用，跳过处理`);
            return { status: "continue", skipped: true };
        }

        // 点击保存按钮，添加重试机制
        let saveButton;
        for (let retryCount = 0; retryCount < 3; retryCount++) {
            try {
                saveButton = await waitForElement('button[aria-label^="保存"], button[aria-label^="Save"]', 3000);
                if (!saveButton) {
                    console.log(`未找到保存按钮，视频可能不可用`);
                    return { status: "continue", skipped: true };
                }
                await new Promise(r => setTimeout(r, 500));
                saveButton.click();
                break;
            } catch (error) {
                console.log(`第 ${retryCount + 1} 次尝试点击保存按钮失败，等待重试...`);
                // 最后一次重试失败，检查视频是否真的不可用
                if (retryCount === 2) {
                    if (!await isVideoAvailable()) {
                        console.log(`视频 ${videoId} 不可用，跳过处理`);
                        return { status: "continue", skipped: true };
                    }
                    throw error;
                }
                await new Promise(r => setTimeout(r, 1000));
            }
        }


        // 等待播放列表菜单出现
        // 注意：YouTube 已将"保存到播放列表"弹窗迁移到新的 yt-sheet-view-model 组件，
        // 旧的 #playlists 容器已不存在，这是 playlist 迁移失效的根本原因。
        let playlistsContainer;
        for (let retryCount = 0; retryCount < 3; retryCount++) {
            try {
                playlistsContainer = await waitForElement('yt-sheet-view-model');
                break;
            } catch (error) {
                console.log(`第 ${retryCount + 1} 次尝试获取播放列表容器失败，重试中...`);
                // 重新点击保存按钮
                saveButton.click();
                await new Promise(r => setTimeout(r, 1500));
                if (retryCount === 2) throw error;
            }
        }

        try {
            // 等待播放列表选项加载完成
            await new Promise(r => setTimeout(r, 1000));

            // 查找目标播放列表
            // 新版弹窗中每个播放列表是一个 yt-list-item-view-model[role="listitem"]，
            // 标题在 [class*="Title"] 元素里，勾选状态由内部 button 的 aria-pressed 表示。
            const allOptions = playlistsContainer.querySelectorAll('yt-list-item-view-model[role="listitem"]');
            let targetOption = null;

            // Google Takeout 会把文件名里的非法字符（/ \ : * ? " < > |）替换成下划线，
            // 而 playlistName 是从 CSV 文件名推导出来的，所以真实标题里的 "/" 等在这里会变成 "_"。
            // 先按真实标题精确匹配，匹配不上时再按同样的归一化规则回退匹配。
            const sanitize = (s) => s.replace(/[/\\:*?"<>|]/g, '_');
            const wantedSanitized = sanitize(playlistName);

            for (const option of allOptions) {
                const titleElement = option.querySelector('[class*="Title"]');
                if (!titleElement) continue;
                const title = titleElement.textContent.trim();
                if (title === playlistName || sanitize(title) === wantedSanitized) {
                    targetOption = option;
                    break;
                }
            }

            if (targetOption) {
                const toggleButton = targetOption.querySelector('button') || targetOption;
                const isChecked = toggleButton.getAttribute('aria-pressed') === 'true';

                if (!isChecked) {
                    console.log(`将视频添加到播放列表 ${playlistName}`);
                    toggleButton.click();
                    await new Promise(r => setTimeout(r, 500));
                } else {
                    console.log(`视频已在播放列表 ${playlistName} 中，跳过`);
                }
            } else {
                console.log(`播放列表 ${playlistName} 不存在，创建新的...`);
                const createNewButton = await waitForElement('button[aria-label^="新建播放列表"], button[aria-label^="New playlist"]');
                createNewButton.click();
                await new Promise(r => setTimeout(r, 1000));

                const nameInput = await waitForElement('textarea.ytStandardsTextareaShapeTextarea');
                nameInput.value = playlistName;
                nameInput.dispatchEvent(new Event('input', { bubbles: true }));
                await new Promise(r => setTimeout(r, 500));

                const createButton = await waitForElement('.yt-spec-button-shape-next--filled[aria-label^="创建"], .yt-spec-button-shape-next--filled[aria-label^="Create"]');
                createButton.click();
            }
        } catch (error) {
            console.error('处理播放列表选项失败:', error);
            throw error;
        }

        // 等待操作完成
        await new Promise(r => setTimeout(r, 1500));
        console.log(`视频 ${videoId} 已处理完成`);
        return { status: "continue", success: true }; // 修改返回值格式

    } catch (error) {
        console.error(`添加视频 ${videoId} 失败:`, error);
        return { status: "continue", error: error.message }; // 即使失败也继续处理下一个
    }
}
