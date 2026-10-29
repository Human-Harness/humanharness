import os from "node:os";
import path from "node:path";

/**
 * The person's own npm config file. The engine-config code never names a home folder (E7: no engine home); a package
 * runner check only needs to tell this one file, which is the person's and not the folder's, from a `.npmrc` an agent
 * could write in the folder or above it. It is compared by path (lstat), never read.
 */
export const USER_NPMRC = path.join(os.homedir(), ".npmrc");
