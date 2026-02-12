import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// src/ → server/ → packages/ → root (works from dist/ too — same depth)
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });
