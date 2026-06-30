// 修改 updateFileInputLabel 函数
function updateFileInputLabel(input, defaultText) {
    const wrapper = input.parentElement;
    const label = wrapper.querySelector('.custom-file-input');

    input.addEventListener('change', (event) => {
        if (input.hasAttribute('webkitdirectory')) {
            const files = Array.from(event.target.files || []).filter(file => file.name.endsWith('-videos.csv'));
            label.textContent = files.length > 0 ? `${files.length} playlist files selected` : defaultText;
        } else {
            label.textContent = event.target.files[0]?.name || defaultText;
        }
    });
}


// 处理文件上传
async function handleFile(event) {
    const file = event.target.files[0];
    console.log('File selected:', file?.name);

    try {
        // 1. 读取 CSV 文件
        const csvData = await readFileAsync(file);
        console.log('CSV data loaded, length:', csvData.length);

        // 2. 直接发送数据到 background script 处理
        console.log('Sending data to background script...');
        chrome.runtime.sendMessage({
            action: "processCSV",
            data: csvData
        }, response => {
            console.log('Background script response:', response);
            if (chrome.runtime.lastError) {
                console.error('Error:', chrome.runtime.lastError);
                const errorDiv = document.getElementById('errorMessage');
                errorDiv.textContent = 'Error: ' + chrome.runtime.lastError.message;
                errorDiv.style.display = 'block';
            } else {
                const messageDiv = document.getElementById('message');
                messageDiv.textContent = 'Processing channels...';
                messageDiv.className = 'message';
            }
        });

    } catch (error) {
        console.error('Error:', error);
        const errorDiv = document.getElementById('errorMessage');
        errorDiv.textContent = 'Error: ' + error.message;
        errorDiv.style.display = 'block';
    }
}

// 处理播放列表文件夹
async function handlePlaylistFolder(event) {
    const files = Array.from(event.target.files || []).filter(file => file.name.endsWith('-videos.csv'));
    const messageDiv = document.getElementById('playlistMessage');
    const errorDiv = document.getElementById('playlistError');

    messageDiv.textContent = '';
    errorDiv.textContent = '';
    errorDiv.style.display = 'none';

    if (!files || files.length === 0) {
        errorDiv.textContent = 'Choose a folder containing playlist files ending with -videos.csv';
        errorDiv.style.display = 'block';
        return;
    }

    try {
        const allPlaylists = [];
        for (const file of files) {
            const csvData = await readFileAsync(file);
            const playlistName = file.name.replace('-videos.csv', '');
            const videos = CSVToArray(csvData).slice(1);
            allPlaylists.push({
                name: playlistName,
                videos: videos.map(row => row[0]).filter(id => id)
            });
        }

        chrome.runtime.sendMessage({
            action: "processAllPlaylists",
            playlists: allPlaylists
        }, (response) => {
            if (chrome.runtime.lastError) {
                errorDiv.textContent = 'Error: ' + chrome.runtime.lastError.message;
                errorDiv.style.display = 'block';
            } else if (response?.received) {
                messageDiv.textContent = 'Processing playlists...';
                messageDiv.className = 'message';
            } else if (response?.success) {
                messageDiv.textContent = 'All playlists processed successfully';
                messageDiv.className = 'message success';
            } else {
                errorDiv.textContent = 'Process error: ' + (response?.error || 'Unknown error');
                errorDiv.style.display = 'block';
            }
        });
    } catch (error) {
        console.error('处理播放列表失败:', error);
        errorDiv.textContent = `Processing failed: ${error.message}`;
        errorDiv.style.display = 'block';
    }
}

// 辅助函数：将 FileReader 包装为 Promise
function readFileAsync(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(reader.error);
        reader.readAsText(file);
    });
}

// CSV 解析函数
function CSVToArray(strData, strDelimiter = ",") {
    const objPattern = new RegExp(
        ("(\\" + strDelimiter + "|\\r?\\n|\\r|^)" +
            "(?:\"([^\"]*(?:\"\"[^\"]*)*)\"|" +
            "([^\"\\" + strDelimiter + "\\r\\n]*))"),
        "gi"
    );
    const arrData = [[]];
    let arrMatches = null;
    while ((arrMatches = objPattern.exec(strData))) {
        const strMatchedDelimiter = arrMatches[1];
        if (strMatchedDelimiter.length && strMatchedDelimiter !== strDelimiter) {
            arrData.push([]);
        }
        let strMatchedValue = arrMatches[2] ?
            arrMatches[2].replace(new RegExp("\"\"", "g"), "\"") :
            arrMatches[3];
        arrData[arrData.length - 1].push(strMatchedValue);
    }
    return arrData;
}

// 初始化
let keepAliveInterval;
document.addEventListener('DOMContentLoaded', () => {
    console.log('popup.js 初始化');
    const fileInput = document.getElementById('fileInput');
    const playlistFolderInput = document.getElementById('playlistFolderInput');

    // 初始化进度条
    const progressContainer = document.querySelector('.channels .progress');
    if (progressContainer) {
        progressContainer.style.display = 'none';
    }
    const progressBar = document.querySelector('.channels .progress-bar');
    if (progressBar) {
        progressBar.style.width = '0%';
    }

    if (fileInput) {
        console.log('找到文件输入框，添加事件监听器');
        // 移除旧的事件监听器
        fileInput.removeEventListener('change', handleFile);
        // 添加新的事件监听器
        fileInput.addEventListener('change', handleFile);
        updateFileInputLabel(fileInput, 'Choose CSV file');
    }

    if (playlistFolderInput) {
        updateFileInputLabel(playlistFolderInput, 'Choose folder');
        playlistFolderInput.addEventListener('change', handlePlaylistFolder);
    }

    // 保持 popup 活跃
    keepAliveInterval = setInterval(() => {
        chrome.runtime.sendMessage({ action: "keepAlive" });
    }, 25000);
});

// 在 popup 关闭时清除定时器
window.addEventListener('unload', () => {
    if (keepAliveInterval) {
        clearInterval(keepAliveInterval);
    }
});

// 监听来自后台脚本的消息
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {

    if (request.action === "processComplete") {
        const messageDiv = document.getElementById('message');
        const errorMessageDiv = document.getElementById('errorMessage');

        if (request.success) {
            messageDiv.textContent = 'Process completed successfully';
            messageDiv.className = 'message success';
        } else {
            errorMessageDiv.textContent = 'Process error: ' + request.error;
            errorMessageDiv.style.display = 'block';
        }
    }
    if (request.action === "updateProgress") {
        const progressBar = document.querySelector(`.${request.type} .progress-bar`);
        const progressContainer = document.querySelector(`.${request.type} .progress`);
        if (progressBar && progressContainer) {
            progressContainer.style.display = 'block';
            progressBar.style.width = `${request.progress}%`;
            console.log(`更新进度: ${request.progress}%`); // 添加日志
        } else {
            console.log('进度条元素未找到'); // 添加调试信息
        }
    } else if (request.action === "playlistsCompleted") {
        // Show completion message
        const messageDiv = document.getElementById('playlistMessage');
        if (messageDiv) {
            messageDiv.textContent = 'All playlists processed successfully';
            messageDiv.className = 'message success';
        }

        // Hide progress bar
        const progressContainer = document.querySelector('.playlists .progress');
        if (progressContainer) {
            progressContainer.style.display = 'none';
        }

    } else if (request.action === "playlistsError") {
        // Show error message
        const errorDiv = document.getElementById('playlistError');
        if (errorDiv) {
            errorDiv.textContent = `Processing failed: ${request.error}`;
            errorDiv.style.display = 'block';
        }

        // Also use notification
        chrome.notifications.create({
            type: 'basic',
            iconUrl: 'icon48.png',
            title: 'Failed to process playlists',
            message: `Processing failed: ${request.error}`
        });
    }
});
