declare global {
  namespace Express {
    interface User {
      id?: number;
      username?: string;
      role?: 'admin' | 'user';
      type?: 'access' | 'refresh';
    }
  }
}

export {};
