// Updates the label of a custom file input
function updateFileInputLabel(input, defaultText) {
    const wrapper = input.parentElement;
    const label = wrapper.querySelector('.custom-file-input');

    input.addEventListener('change', (event) => {
        if (input.hasAttribute('webkitdirectory')) {
            const files = Array.from(event.target.files || []).filter(file => file.name.toLowerCase().endsWith('.csv'));
            label.textContent = files.length > 0 ? `${files.length} playlist files selected` : defaultText;
        } else {
            label.textContent = event.target.files[0]?.name || defaultText;
        }
    });
}


// Handles CSV file upload
async function handleFile(event) {
    const file = event.target.files[0];
    console.log('File selected:', file?.name);

    try {
        // 1. Read the CSV file
        const csvData = await readFileAsync(file);
        console.log('CSV data loaded, length:', csvData.length);

        // 2. Send the data to the background script for processing
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
                messageDiv.textContent = 'Processing subscriptions...';
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

// Handles the playlist folder selection
async function handlePlaylistFolder(event) {
    const files = Array.from(event.target.files || []).filter(file => file.name.toLowerCase().endsWith('.csv'));
    const messageDiv = document.getElementById('playlistMessage');
    const errorDiv = document.getElementById('playlistError');

    messageDiv.textContent = '';
    errorDiv.textContent = '';
    errorDiv.style.display = 'none';

    if (!files || files.length === 0) {
        errorDiv.textContent = 'Choose a folder containing playlist CSV files';
        errorDiv.style.display = 'block';
        return;
    }

    try {
        const allPlaylists = [];
        for (const file of files) {
            const csvData = await readFileAsync(file);
            // YouTube now exports playlists as plain .csv files (no -videos suffix).
            // Derive the playlist name from the filename, keeping backward
            // compatibility with the old <name>-videos.csv format.
            const playlistName = file.name.replace(/\.csv$/i, '').replace(/-videos$/i, '');
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
        console.error('Failed to process playlists:', error);
        errorDiv.textContent = `Processing failed: ${error.message}`;
        errorDiv.style.display = 'block';
    }
}

// Helper: wrap FileReader in a Promise
function readFileAsync(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(reader.error);
        reader.readAsText(file);
    });
}

// CSV parsing function
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

// Initialization
let keepAliveInterval;
document.addEventListener('DOMContentLoaded', () => {
    console.log('popup.js initialized');
    const fileInput = document.getElementById('fileInput');
    const playlistFolderInput = document.getElementById('playlistFolderInput');

    // Reset the progress bar
    const progressContainer = document.querySelector('.channels .progress');
    if (progressContainer) {
        progressContainer.style.display = 'none';
    }
    const progressBar = document.querySelector('.channels .progress-bar');
    if (progressBar) {
        progressBar.style.width = '0%';
    }

    if (fileInput) {
        console.log('File input found, adding event listener');
        // Remove the old event listener
        fileInput.removeEventListener('change', handleFile);
        // Add the new event listener
        fileInput.addEventListener('change', handleFile);
        updateFileInputLabel(fileInput, 'Choose CSV file');
    }

    if (playlistFolderInput) {
        updateFileInputLabel(playlistFolderInput, 'Choose folder');
        playlistFolderInput.addEventListener('change', handlePlaylistFolder);
    }

    // Keep the popup alive
    keepAliveInterval = setInterval(() => {
        chrome.runtime.sendMessage({ action: "keepAlive" });
    }, 25000);
});

// Clear the timer when the popup closes
window.addEventListener('unload', () => {
    if (keepAliveInterval) {
        clearInterval(keepAliveInterval);
    }
});

// Listen for messages from the background script
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
            console.log(`Updating progress: ${request.progress}%`); // add logging
        } else {
            console.log('Progress bar element not found'); // add debugging info
        }

        // Update the text progress indicator, e.g. "Processing subscriptions (2/54)"
        if (request.type === "channels" && request.total > 0) {
            const messageDiv = document.getElementById('message');
            if (messageDiv) {
                messageDiv.textContent = `Processing subscriptions (${request.current}/${request.total})`;
            }
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
