/**
 * Profanity Filter for Chat Messages
 * Censors offensive words and slurs
 */

// List of words to filter (add more as needed)
const PROFANITY_LIST = [
  // Racial slurs
  'nigger', 'nigga', 'n1gger', 'n1gga', 'nig', 'nigg',
  // Other offensive terms
  'fuck', 'shit', 'bitch', 'ass', 'cunt', 'dick', 'pussy',
  'retard', 'fag', 'faggot', 'whore', 'slut',
  // Add more as needed
];

// Common character substitutions used to bypass filters
const SUBSTITUTIONS: Record<string, string[]> = {
  'a': ['@', '4', 'α'],
  'e': ['3', 'ε'],
  'i': ['1', '!', 'l', '|'],
  'o': ['0', 'ο'],
  's': ['$', '5', 'ς'],
  'g': ['9', 'q'],
  't': ['7', '+'],
};

/**
 * Normalize text to catch leetspeak and character substitutions
 */
function normalizeText(text: string): string {
  let normalized = text.toLowerCase();
  
  // Replace common substitutions
  for (const [char, subs] of Object.entries(SUBSTITUTIONS)) {
    for (const sub of subs) {
      normalized = normalized.replace(new RegExp(sub.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), char);
    }
  }
  
  // Remove spaces, underscores, dashes that might be used to bypass filter
  normalized = normalized.replace(/[\s_\-\.]/g, '');
  
  return normalized;
}

/**
 * Check if text contains profanity
 */
export function containsProfanity(text: string): boolean {
  const normalized = normalizeText(text);
  
  for (const word of PROFANITY_LIST) {
    if (normalized.includes(word)) {
      return true;
    }
  }
  
  return false;
}

/**
 * Censor profanity in text by replacing with asterisks
 */
export function censorProfanity(text: string): string {
  let censored = text;
  const normalized = normalizeText(text);
  
  for (const word of PROFANITY_LIST) {
    if (normalized.includes(word)) {
      // Create a regex that matches the word with any character substitutions
      const pattern = word.split('').map(char => {
        const subs = SUBSTITUTIONS[char] || [];
        if (subs.length > 0) {
          return `[${char}${subs.join('')}\\s_\\-\\.]*`;
        }
        return `${char}[\\s_\\-\\.]*`;
      }).join('');
      
      const regex = new RegExp(pattern, 'gi');
      censored = censored.replace(regex, (match) => '*'.repeat(Math.max(match.length, 3)));
    }
  }
  
  return censored;
}

/**
 * Filter chat message - returns censored version or null if message should be blocked
 */
export function filterChatMessage(message: string, blockIfProfane: boolean = false): string | null {
  if (containsProfanity(message)) {
    if (blockIfProfane) {
      return null; // Block the message entirely
    }
    return censorProfanity(message); // Censor the profanity
  }
  
  return message; // Message is clean
}
