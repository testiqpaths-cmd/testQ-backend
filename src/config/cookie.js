import cookieParser from 'cookie-parser';
import dotenv from 'dotenv';

dotenv.config();

export const cookieConfig = cookieParser(process.env.COOKIE_SECRET);
