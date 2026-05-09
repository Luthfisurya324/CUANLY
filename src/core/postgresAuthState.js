import { initAuthCreds, BufferJSON, proto } from '@whiskeysockets/baileys';
import { db } from '../db/index.js';
import { baileys_auth } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('auth');

export const usePostgresAuthState = async () => {
    const readData = async (id) => {
        try {
            const result = await db.select().from(baileys_auth).where(eq(baileys_auth.id, id)).limit(1);
            if (result.length > 0) {
                return JSON.parse(result[0].data, BufferJSON.reviver);
            }
            return null;
        } catch (error) {
            logger.error(error, `Error reading auth state ${id}`);
            return null;
        }
    };

    const writeData = async (data, id) => {
        try {
            const stringified = JSON.stringify(data, BufferJSON.replacer);
            await db.insert(baileys_auth)
                .values({ id, data: stringified })
                .onConflictDoUpdate({
                    target: baileys_auth.id,
                    set: { data: stringified }
                });
        } catch (error) {
            logger.error(error, `Error writing auth state ${id}`);
        }
    };

    const removeData = async (id) => {
        try {
            await db.delete(baileys_auth).where(eq(baileys_auth.id, id));
        } catch (error) {
            logger.error(error, `Error removing auth state ${id}`);
        }
    };

    let creds = await readData('creds');
    if (!creds) {
        creds = initAuthCreds();
        await writeData(creds, 'creds');
    }

    return {
        state: {
            creds,
            keys: {
                get: async (type, ids) => {
                    const data = {};
                    await Promise.all(ids.map(async (id) => {
                        let value = await readData(`${type}-${id}`);
                        if (type === 'app-state-sync-key' && value) {
                            value = proto.Message.AppStateSyncKeyData.fromObject(value);
                        }
                        data[id] = value;
                    }));
                    return data;
                },
                set: async (data) => {
                    const tasks = [];
                    for (const category in data) {
                        for (const id in data[category]) {
                            const value = data[category][id];
                            const key = `${category}-${id}`;
                            if (value) {
                                tasks.push(writeData(value, key));
                            } else {
                                tasks.push(removeData(key));
                            }
                        }
                    }
                    await Promise.all(tasks);
                }
            }
        },
        saveCreds: () => {
            return writeData(creds, 'creds');
        }
    };
};
