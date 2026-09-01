class KeyValueStore {
  private store: Map<string, any>;

  constructor() {
    this.store = new Map();
  }

  async get(key: string): Promise<any> {
    return this.store.get(key);
  }

  async set(key: string, value: any): Promise<boolean> {
    this.store.set(key, value);
    return true;
  }

  async setTTL(key: string, value: any, ttl: number): Promise<boolean> {
    this.store.set(key, value);
    
    setTimeout(() => {
      this.store.delete(key);
    }, ttl * 1000);

    return true;
  }

  async delete(key: string): Promise<boolean> {
    return this.store.delete(key);
  }

  async has(key: string): Promise<boolean> {
    return this.store.has(key);
  }

  async clear(): Promise<void> {
    this.store.clear();
  }
}

export const kv = new KeyValueStore();
export default kv;
