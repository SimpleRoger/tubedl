import { Router, type IRouter } from "express";
import healthRouter from "./health";
import videosRouter from "./videos";
import videoDownloadRouter from "./video-download";
import videoUrlRouter from "./video-url";
import savedRouter from "./saved";
import channelsRouter from "./channels";
import detectBpmRouter from "./detect-bpm";
import detectKeyRouter from "./detect-key";
import singRatingRouter from "./sing-rating";

const router: IRouter = Router();

router.use(healthRouter);
router.use(videosRouter);
router.use(videoDownloadRouter);
router.use(videoUrlRouter);
router.use(savedRouter);
router.use(channelsRouter);
router.use(detectBpmRouter);
router.use(detectKeyRouter);
router.use(singRatingRouter);

export default router;
