let observer;

chrome.runtime.onMessage.addListener((request, _, sendResponse) => {
    if (request.action === "subscribeToChannel") {
        (async () => {
            try {
                await subscribeToChannel(request.channelUrl, request.channelTitle);
                sendResponse({ status: "success" });
            } catch (error) {
                console.error(`订阅失败: ${error}`);
                sendResponse({ status: "error", error: error.message });
            }
        })();
        return true; // Indicates that async response will be sent
    }
});

// 等待页面加载某个元素
const waitForElement = (selector, timeout = 5000) => {
    return new Promise((resolve, reject) => {
        const startTime = Date.now();
        const checkElement = () => {
            const element = document.querySelector(selector);
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
        await waitForElement('body'); // 等待页面主体加载

        // 等待订阅按钮出现
        const subscribeButton = await waitForElement('button[aria-label^="订阅"], button[aria-label^="Subscribe"]');
        console.log('找到订阅按钮:', subscribeButton);

        // 检查按钮状态
        const buttonText = subscribeButton.textContent.trim().toLowerCase();
        if (buttonText.includes('订阅') || buttonText.includes('subscribe')) {
            // 创建鼠标点击事件
            const event = new MouseEvent('click', {
                bubbles: true,
                cancelable: true,
                view: window
            });
            subscribeButton.dispatchEvent(event);
            console.log('已点击订阅按钮');
        } else {
            console.log('频道已经被订阅，无需操作');
        }
    } catch (error) {
        console.error('订阅过程中发生错误:', error);
        throw error; // 将错误抛出以便于上层捕获
    }
};