export const LOCK_GLOBAL_NGINX = 'nginx_conf_lock';

export const serverLock = (name: string) => `server:${name}`;
export const coreLock = (name: string) => `core:${name}`;
export const templateLock = (name: string) => `template:${name}`;
export const alertLock = () => 'alert:config';
