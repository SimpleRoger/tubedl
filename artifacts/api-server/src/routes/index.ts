import { Router, type IRouter } from "express";
import healthRouter from "./health";
import channelsRouter from "./channels";
import videosRouter from "./videos";
import summaryRouter from "./summary";
import beatChannelsRouter from "./beat-channels";
import storageRouter from "./storage";
import recordingsRouter from "./recordings";
import savedRouter from "./saved";

const router: IRouter = Router();

router.use(healthRouter);
router.use(channelsRouter);
router.use(videosRouter);
router.use(summaryRouter);
router.use(beatChannelsRouter);
router.use(storageRouter);
router.use(recordingsRouter);
router.use(savedRouter);

export default router;
