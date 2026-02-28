import express from 'express';
import cookieParser from 'cookie-parser';
import jwt from 'jsonwebtoken';

const TEST_JWT_SECRET = 'test-jwt-secret';
const TEST_JWT_SECRET_REFRESH = 'test-jwt-refresh-secret';

export const createTestApp = (router) => {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api', router);
  return app;
};

export const adminPayload = { id: 1, mailbox: 'admin@test.com', username: 'admin', isAdmin: 1, isActive: 1, roles: [] };
export const userPayload = { id: 2, mailbox: 'user@test.com', username: 'user', isAdmin: 0, isActive: 1, roles: ['user@test.com'] };
export const inactivePayload = { id: 3, mailbox: 'inactive@test.com', username: 'inactive', isAdmin: 0, isActive: 0, roles: [] };

export const adminToken = jwt.sign(adminPayload, TEST_JWT_SECRET, { expiresIn: '1h' });
export const userToken = jwt.sign(userPayload, TEST_JWT_SECRET, { expiresIn: '1h' });
export const inactiveToken = jwt.sign(inactivePayload, TEST_JWT_SECRET, { expiresIn: '1h' });

export { TEST_JWT_SECRET, TEST_JWT_SECRET_REFRESH };
