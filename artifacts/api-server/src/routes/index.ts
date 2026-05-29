import { Router, type IRouter } from "express";
import healthRouter from "./health";
import videosRouter from "./videos";
import videoDownloadRouter from "./video-download";

const router: IRouter = Router();

router.use(healthRouter);
router.use(videosRouter);
router.use(videoDownloadRouter);

export default router;
