import fs from 'node:fs';
import * as fsPromises from 'node:fs/promises';
import os from 'node:os';

import spawn from 'cross-spawn';

import { projectsDb } from '@/modules/database/index.js';

import { createTaskmasterApiService } from './taskmaster-api.service.js';
import { createTaskmasterRouter } from './taskmaster.routes.js';
import { taskmasterInitializerService } from './taskmaster-initializer.service.js';
import { createTaskmasterService } from './taskmaster.service.js';
import { taskmasterWorkflowService } from './taskmaster-workflow.service.js';

const taskmasterStatusService = createTaskmasterService({
  readTextFile: (filePath) => fsPromises.readFile(filePath, 'utf8'),
  getHomeDirectory: os.homedir,
});

const taskmasterService = createTaskmasterApiService({
  fileSystem: fs,
  fileSystemPromises: fsPromises,
  spawnProcess: spawn,
  resolveProjectPathById: (projectId) => projectsDb.getProjectPathById(projectId),
  taskmasterStatusService,
  taskmasterInitializer: taskmasterInitializerService,
  taskmasterWorkflow: taskmasterWorkflowService,
});

/** Used by the server entrypoint to mount authenticated TaskMaster endpoints. */
export const taskmasterRoutes = createTaskmasterRouter({
  taskmasterService,
});
