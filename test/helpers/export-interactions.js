import { exportDestination } from "../../src/services/export-destination.js";

export const acceptExportDestination = {
  chooseDestination: async (app, request) => exportDestination(app, request.folderPath, request.fileName, request.extension),
  presentResult: () => {},
};
