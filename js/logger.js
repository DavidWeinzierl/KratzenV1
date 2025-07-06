import { isSimulationRunning } from './controller.js';

const logBox = document.getElementById('log-box');

export function logMessage(message) {

        // If a simulation is running, do not touch the DOM at all.
        if (isSimulationRunning) {
            return;
        }

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