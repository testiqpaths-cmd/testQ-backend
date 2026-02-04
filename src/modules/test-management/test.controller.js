  import * as service from "./test.service.js";

  export async function createTest(req, res, next) {
    try {
      const test = await service.createTest(req.body, req.user);
      res.status(201).json({ success: true, data: test });
    } catch (e) {
      next(e);
    }
  }

  export async function getTest(req, res) {
    res.json({ success: true, data: req.test });
  }

  export async function updateTest(req, res, next) {
    try {
      const test = await service.updateTest(req.test, req.body);
      res.json({ success: true, data: test });
    } catch (e) {
      next(e);
    }
  }

  export async function deleteTest(req, res, next) {
    try {
      await service.deleteTest(req.test);
      res.status(204).end();
    } catch (e) {
      next(e);
    }
  }
