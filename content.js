let observer;

chrome.runtime.onMessage.addListener((request, _, sendResponse) => {
    if (request.action === "subscribeToChannel") {
        console.log('Received subscribe request:', request);

        // Perform the subscription
        subscribeToChannel(request.channelUrl, request.channelTitle)
            .then(subscribed => {
                if (subscribed) {
                    sendResponse({ status: "success", message: "Successfully subscribed" });
                } else {
                    sendResponse({ status: "success", message: "Already subscribed" });
                }
            })
            .catch(error => {
                console.error('Subscribe failed:', error);
                sendResponse({ status: "error", message: error.message });
            });

        return true; // keep the message channel open
    }
    if (request.action === "processCSV") {
        // Create a new Promise chain to handle the whole flow
        (async () => {
            try {
                await processChannels(request.data);
                // Wait here for the page navigation to finish
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
                // Navigate to the error page on failure
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
        return true; // keep the message channel open
    }
    if (request.action === "createPlaylist") {
        (async () => {
            try {
                const result = await addVideoToPlaylist(request.currentVideo, request.name);
                console.log('Video processing result:', result);
                sendResponse(result);
            } catch (error) {
                console.error('Failed to process playlist:', error);
                sendResponse({ status: "continue", error: error.message });
            }
        })();
        return true;
    }
});

// Wait for an element to appear in the page, with retry
const waitForElement = (selector, timeout = 5000, parent = document) => {
    return new Promise((resolve, reject) => {
        const startTime = Date.now();

        const checkElement = () => {
            const element = parent.querySelector(selector);
            if (element) {
                resolve(element);
            } else if (Date.now() - startTime > timeout) {
                reject(new Error(`Element ${selector} not found within ${timeout}ms`));
            } else {
                setTimeout(checkElement, 100);
            }
        };
        checkElement();
    });
};

// Subscribe to a channel
const subscribeToChannel = async (channelUrl, channelTitle) => {
    console.log(`Attempting to subscribe to channel: ${channelTitle} (${channelUrl})`);

    try {
        // Wait for the page to load
        await new Promise(r => setTimeout(r, 500)); // extra wait to let YouTube dynamic content load

        // Try several possible subscribe button selectors
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
                console.log(`Selector ${selector} button not found, trying the next one...`);
            }
        }

        if (!subscribeButton) {
            throw new Error('Subscribe button not found');
        }

        console.log('Subscribe button found:', subscribeButton);

        // Check the button state
        const buttonText = subscribeButton.textContent.trim().toLowerCase();
        const ariaLabel = subscribeButton.getAttribute('aria-label')?.toLowerCase() || '';
        
        const isSubscribed = 
            buttonText.includes('已订阅') || 
            buttonText.includes('subscribed') ||
            ariaLabel.includes('取消订阅') ||
            ariaLabel.includes('unsubscribe');

        if (!isSubscribed) {
            // Click the subscribe button
            subscribeButton.click();
            console.log('Subscribe button clicked');

            // Wait for the subscription state to update
            await new Promise(r => setTimeout(r, 200));
            
            // Verify the subscription succeeded
            const newButtonText = subscribeButton.textContent.trim().toLowerCase();
            const newAriaLabel = subscribeButton.getAttribute('aria-label')?.toLowerCase() || '';
            const subscribeSuccess = 
                newButtonText.includes('已订阅') || 
                newButtonText.includes('subscribed') ||
                newAriaLabel.includes('取消订阅') ||
                newAriaLabel.includes('unsubscribe');
                
            if (!subscribeSuccess) {
                throw new Error('Subscription was not completed successfully');
            }
            
            return true;
        } else {
            console.log('Channel already subscribed, no action needed');
            return false;
        }
    } catch (error) {
        console.error('Error during subscription:', error);
        throw error; // rethrow properly
    }
};

async function isVideoAvailable() {
    try {
        const videoId = new URL(window.location.href).searchParams.get('v');
        if (!videoId) return false;

        const response = await fetch(`https://img.youtube.com/vi/${videoId}/default.jpg`);
        if (!response.ok) {
            console.log(`Thumbnail for video ${videoId} does not exist; video may be unavailable`);
            return false;
        }

        return true;
    } catch (error) {
        console.log(`Failed to check video thumbnail:`, error);
        return false;
    }
}

// Wait for the page to load
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
        // Make sure the page is fully loaded
        await waitForPageLoad();

        // Wait longer so error info and video info are fully loaded
        await new Promise(r => setTimeout(r, 3000));

        // Check whether the video is available
        if (!await isVideoAvailable()) {
            console.log(`Video ${videoId} is unavailable, skipping`);
            return { status: "continue", skipped: true };
        }

        // Click the save button, with retry
        let saveButton;
        for (let retryCount = 0; retryCount < 3; retryCount++) {
            try {
                saveButton = await waitForElement('button[aria-label^="保存"], button[aria-label^="Save"]', 3000);
                if (!saveButton) {
                    console.log(`Save button not found; video may be unavailable`);
                    return { status: "continue", skipped: true };
                }
                await new Promise(r => setTimeout(r, 500));
                saveButton.click();
                break;
            } catch (error) {
                console.log(`Attempt ${retryCount + 1} to click the save button failed, retrying...`);
                // Last retry failed; check whether the video is truly unavailable
                if (retryCount === 2) {
                    if (!await isVideoAvailable()) {
                        console.log(`Video ${videoId} is unavailable, skipping`);
                        return { status: "continue", skipped: true };
                    }
                    throw error;
                }
                await new Promise(r => setTimeout(r, 1000));
            }
        }


        // Wait for the playlist menu to appear
        // Note: YouTube moved the "Save to playlist" dialog to the new yt-sheet-view-model component;
        // the old #playlists container no longer exists, which is why playlist migration broke.
        let playlistsContainer;
        for (let retryCount = 0; retryCount < 3; retryCount++) {
            try {
                playlistsContainer = await waitForElement('yt-sheet-view-model');
                break;
            } catch (error) {
                console.log(`Attempt ${retryCount + 1} to get the playlist container failed, retrying...`);
                // Click the save button again
                saveButton.click();
                await new Promise(r => setTimeout(r, 1500));
                if (retryCount === 2) throw error;
            }
        }

        try {
            // Wait for the playlist options to load
            await new Promise(r => setTimeout(r, 1000));

            // Find the target playlist
            // In the new dialog each playlist is a yt-list-item-view-model[role="listitem"],
            // the title is in a [class*="Title"] element, and the checked state is the inner button's aria-pressed.
            const allOptions = playlistsContainer.querySelectorAll('yt-list-item-view-model[role="listitem"]');
            let targetOption = null;

            // Google Takeout replaces illegal filename characters (/ \ : * ? " < > |) with underscores,
            // while playlistName is derived from the CSV filename, so a real title's "/" appears here as "_".
            // First match the exact title, then fall back to the same normalization rule.
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
                    console.log(`Adding video to playlist ${playlistName}`);
                    toggleButton.click();
                    await new Promise(r => setTimeout(r, 500));
                } else {
                    console.log(`Video already in playlist ${playlistName}, skipping`);
                }
            } else {
                console.log(`Playlist ${playlistName} does not exist, creating a new one...`);
                const createNewButton = await waitForElement('button[aria-label^="新建播放列表"], button[aria-label^="New playlist"]', 5000, playlistsContainer);
                createNewButton.click();
                await new Promise(r => setTimeout(r, 1000));

                const nameInput = await waitForElement('textarea.ytStandardsTextareaShapeTextarea');
                nameInput.value = playlistName;
                nameInput.dispatchEvent(new Event('input', { bubbles: true }));
                await new Promise(r => setTimeout(r, 500));

                const createButton = await waitForElement([
                    '.ytSpecButtonShapeNextFilled[aria-label^="创建"]',
                    '.ytSpecButtonShapeNextFilled[aria-label^="Create"]',
                    '.yt-spec-button-shape-next--filled[aria-label^="创建"]',
                    '.yt-spec-button-shape-next--filled[aria-label^="Create"]'
                ].join(', '));
                createButton.click();
            }
        } catch (error) {
            console.error('Failed to process playlist options:', error);
            throw error;
        }

        // Wait for the operation to complete
        await new Promise(r => setTimeout(r, 1500));
        console.log(`Video ${videoId} processed`);
        return { status: "continue", success: true }; // return value format

    } catch (error) {
        console.error(`Failed to add video ${videoId}:`, error);
        return { status: "continue", error: error.message }; // continue to the next video even on failure
    }
}
