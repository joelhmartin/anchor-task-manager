import express from 'express';

import { requireAuth } from '../middleware/auth.js';
import profileRouter from './hub/profile.js';
import callsRouter from './hub/calls.js';
import publicRouter from './hub/public.js';
import notificationsRouter from './hub/notifications.js';
import emailRouter from './hub/email.js';
import wordpressRouter from './hub/wordpress.js';
import metaRouter from './hub/meta.js';
import analyticsRouter from './hub/analytics.js';
import usersRouter from './hub/users.js';
import activityRouter from './hub/activity.js';
import aiClassificationLogsRouter from './hub/aiClassificationLogs.js';
import adminRouter from './hub/admin.js';
import servicesRouter from './hub/services.js';
import documentsRouter from './hub/documents.js';
import portalRouter from './hub/portal.js';
import oauthRouter from './hub/oauth.js';
import accountsRouter from './hub/accounts.js';
import journeysRouter from './hub/journeys.js';
import leadsRouter from './hub/leads.js';
import contactsRouter from './hub/contacts.js';
import clientsRouter from './hub/clients.js';

const router = express.Router();

router.use(publicRouter);

// All routes below require authentication
router.use(requireAuth);

router.use(notificationsRouter);
router.use(emailRouter);
router.use(wordpressRouter);
router.use(metaRouter);
router.use(analyticsRouter);
router.use(usersRouter);
router.use(activityRouter);
router.use(aiClassificationLogsRouter);
router.use(adminRouter);
router.use(servicesRouter);
router.use(documentsRouter);
router.use(portalRouter);
router.use(oauthRouter);
router.use(accountsRouter);
router.use(journeysRouter);
router.use(leadsRouter);
router.use(contactsRouter);
router.use(callsRouter);
router.use(profileRouter);
router.use(clientsRouter);

export default router;
