import { isSimulationRunning, logInSimulation } from './controller.js';

const logBox = document.getElementById('log-box');

export function logMessage(message) {
    // Block logging ONLY if a simulation is running AND the user has NOT checked the "Log during simulation" box.
    if (isSimulationRunning && !logInSimulation) {
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