const logBox = document.getElementById('log-box');

export function logMessage(message) {
    if (!logBox) {
        console.log("LOG:", message); // Fallback to console if element not found
        return;
    }
    const logEntry = document.createElement('p');
    logEntry.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
    logBox.appendChild(logEntry);
    // Scroll to bottom
    logBox.scrollTop = logBox.scrollHeight;
}