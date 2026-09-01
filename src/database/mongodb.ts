import mongoose from 'mongoose';
import { config } from '../config';
import { backend, error as logError } from '../core/logger';

export async function connectDatabase(): Promise<void> {
  try {
    await mongoose.connect(config.mongodb.uri);
    backend('âœ… Connected to MongoDB');
  } catch (error) {
    logError('âŒ Failed to connect to MongoDB:', error);
    process.exit(1);
  }
}

mongoose.connection.on('disconnected', () => {
  logError('MongoDB disconnected');
});

mongoose.connection.on('error', (error) => {
  logError('MongoDB error:', error);
});
