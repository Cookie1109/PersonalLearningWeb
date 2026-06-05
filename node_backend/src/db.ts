import mysql from 'mysql2/promise';
import { config } from './config';

let connectionUri = config.databaseUrl;
if (connectionUri.startsWith('mysql+pymysql://')) {
  connectionUri = connectionUri.replace('mysql+pymysql://', 'mysql://');
}

// Enable SSL if connecting to TiDB Cloud or if URL specifies SSL
const useSsl = connectionUri.includes('tidbcloud.com') || connectionUri.includes('ssl_verify_cert');

export const pool = mysql.createPool({
  uri: connectionUri,
  ssl: useSsl ? { rejectUnauthorized: false } : undefined,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});

export const query = async (sql: string, params?: any[]): Promise<{ rows: any[] }> => {
  const [rows] = await pool.execute(sql, params);
  // Normalize rows for insert/update results vs select results
  const normalizedRows = Array.isArray(rows) ? (rows as any[]) : [rows as any];
  return { rows: normalizedRows };
};
