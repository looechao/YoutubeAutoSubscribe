document.addEventListener('DOMContentLoaded', () => {
    const fileInput = document.getElementById('fileInput');
    // 确保 fileInput 存在
    if (fileInput) {
        fileInput.addEventListener('change', handleFile);
    } else {
        console.error('fileInput element not found!');
    }
});

function handleFile(event) {
    const file = event.target.files[0]; // 获取用户选择的文件
    const messageDiv = document.getElementById('message');
    const errorMessageDiv = document.getElementById('errorMessage');

    // 清空之前的消息
    messageDiv.textContent = '';
    errorMessageDiv.textContent = '';

    if (file) {
        const reader = new FileReader();
        reader.onload = function (e) {
            const csvData = e.target.result;

            // 发送消息到后台脚本
            chrome.runtime.sendMessage({ action: "processCSV", data: csvData }, (response) => {
                if (chrome.runtime.lastError) {
                    errorMessageDiv.textContent = 'Error: ' + chrome.runtime.lastError.message;
                } else {
                    if (response.success) {
                        messageDiv.textContent = 'CSV processed successfully';
                    } else {
                        errorMessageDiv.textContent = 'Process error: ' + response.error;
                    }
                }
            });
        };

        reader.onerror = function () {
            errorMessageDiv.textContent = 'File read failed';
        };

        reader.readAsText(file); // 读取文件
    } else {
        errorMessageDiv.textContent = 'Please choose a file'; // 提示用户选择文件
    }
}

// 监听来自后台脚本的消息
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "updateStatus") {
        const messageDiv = document.getElementById('message');
        messageDiv.textContent = request.message;
    }
});