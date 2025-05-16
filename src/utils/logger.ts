/**
 * Simple logging utilities
 */

import * as fs from 'fs';
import * as path from 'path';

// Ensure logs directory exists
const logsDir = path.join(__dirname, '../../logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

/**
 * Log data to a file for debugging purposes
 */
export function logToFile(filename: string, data: any): void {
  try {
    const logFile = path.join(logsDir, filename);
    
    // Convert bigints to strings for JSON serialization
    const serializedData = JSON.stringify(data, (_, value) => 
      typeof value === 'bigint' ? value.toString() : value, 2);
    
    // Append to file with timestamp
    const entry = {
      timestamp: new Date().toISOString(),
      data: JSON.parse(serializedData) // Parse back to get proper JSON structure
    };
    
    
    // Load existing entries or create new array
    let entries = [];
    if (fs.existsSync(logFile)) {
      try {
        const content = fs.readFileSync(logFile, 'utf8');
        entries = content ? JSON.parse(content) : [];
      } catch (e) {
        console.error('Error reading log file:', e);
      }
    }
    
    // Add new entry and save
    entries.push(entry);
    fs.writeFileSync(logFile, JSON.stringify(entries, null, 2), 'utf8');
  } catch (error) {
    console.error('Failed to log to file:', error);
  }
}

/**
 * Debug log buy/sell operations
 */
export function logTradeOperation(type: string, data: any): void {
  logToFile('trade-operations.json', { type, ...data });
}
