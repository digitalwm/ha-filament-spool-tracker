import { Router } from 'express';
import statusRoutes from './status';
import spoolRoutes from './spools';
import printJobRoutes from './printJobs';
import printerRoutes from './printers';
import dashboardRoutes from './dashboard';
import haRoutes from './ha';
import settingsRoutes from './settings';
import maintenanceRoutes from './maintenance';

const router: Router = Router();

router.use('/api', statusRoutes);
router.use('/api', spoolRoutes);
router.use('/api', printJobRoutes);
router.use('/api', printerRoutes);
router.use('/api', dashboardRoutes);
router.use('/api', haRoutes);
router.use('/api', settingsRoutes);
router.use('/api', maintenanceRoutes);

export default router;
