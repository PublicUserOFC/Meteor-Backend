import express, { Request, Response, Router } from 'express';

const router: Router = express.Router();

router.get('/eulatracking/api/public/agreements/fn/*', (_req: Request, res: Response) => res.status(204).end());
router.get('/eulatracking/api/public/agreements/fn/account/*', (_req: Request, res: Response) => res.json([]));
router.get('/fortnite/api/game/v2/privacy/account/:accountId', (req: Request, res: Response) => res.json({ accountId: req.params.accountId, optOutOfPublicLeaderboards: false }));
router.post('/fortnite/api/game/v2/privacy/account/:accountId', (req: Request, res: Response) => {
  res.json({ accountId: req.params.accountId, optOutOfPublicLeaderboards: req.body?.optOutOfPublicLeaderboards ?? false });
});
router.get('/lightswitch/api/service/Fortnite/status', (_req: Request, res: Response) => res.json({ serviceInstanceId: 'fortnite', status: 'UP', message: 'Fortnite is online', maintenanceUri: null, overrideCatalogIds: ['a7f138b2e51945ffbfdacc1af0541053'], allowedActions: [], banned: false, launcherInfoDTO: { appName: 'Fortnite', catalogItemId: '4fe75bbc5a674f4f9b356b5c90567da5', namespace: 'fn' } }));
router.get('/lightswitch/api/service/bulk/status', (_req: Request, res: Response) => res.json([{ serviceInstanceId: 'fortnite', status: 'UP', message: 'fortnite is up.', maintenanceUri: null, overrideCatalogIds: ['a7f138b2e51945ffbfdacc1af0541053'], allowedActions: ['PLAY', 'DOWNLOAD'], banned: false, launcherInfoDTO: { appName: 'Fortnite', catalogItemId: '4fe75bbc5a674f4f9b356b5c90567da5', namespace: 'fn' } }]));
router.get('/fortnite/api/version', (_req: Request, res: Response) => res.json({ app: 'fortnite', serverDate: new Date().toISOString(), overridePropertiesVersion: 'unknown', cln: '17951730', build: '444', moduleName: 'Fortnite-Core', buildDate: '2021-10-27T21:00:51.697Z', version: '18.30', branch: 'Release-18.30' }));
router.get('/fortnite/api*/versioncheck*', (_req: Request, res: Response) => res.json({ type: 'NO_UPDATE' }));
router.get('/fortnite/api/v2/versioncheck/*', (_req: Request, res: Response) => res.json({ type: 'NO_UPDATE' }));
router.get('/fortnite/api/v2/versioncheck*', (_req: Request, res: Response) => res.json({ type: 'NO_UPDATE' }));
router.get('/fortnite/api/versioncheck*', (_req: Request, res: Response) => res.json({ type: 'NO_UPDATE' }));

export default router;
