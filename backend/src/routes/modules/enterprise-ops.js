/**
 * Alias mount for enterprise flight ops — same handlers as /api/operations/enterprise/*
 * Supports clients expecting /api/enterprise-ops/*
 */
import express from 'express';
import { registerFlightOpsEnterpriseRoutes } from './flight-ops-enterprise.js';

const router = express.Router();

router.get('/health', (_req, res) => {
  res.json({ module: 'flight-ops-enterprise', status: 'ready', mount: '/api/enterprise-ops' });
});

registerFlightOpsEnterpriseRoutes(router);

export default router;
