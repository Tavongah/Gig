const path = require("node:path");
const { getDefaultConfig } = require("expo/metro-config");
const { withNativeWind } = require("nativewind/metro");
const { resolve: metroResolve } = require("metro-resolver");

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, "../..");

const config = getDefaultConfig(projectRoot);

config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(workspaceRoot, "node_modules")
];
config.resolver.disableHierarchicalLookup = true;

/**
 * @gigflow/shared uses NodeNext `.js` import specifiers that point at `.ts` sources.
 * Metro does not rewrite those automatically — map them for React Native bundling.
 */
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName.startsWith(".") && moduleName.endsWith(".js")) {
    const origin = context.originModulePath.replace(/\\/g, "/");
    if (origin.includes("/packages/shared/")) {
      const asTs = moduleName.replace(/\.js$/, ".ts");
      try {
        return metroResolve(
          { ...context, resolveRequest: metroResolve },
          asTs,
          platform
        );
      } catch {
        // Fall through to default resolution.
      }
    }
  }

  return metroResolve({ ...context, resolveRequest: metroResolve }, moduleName, platform);
};

module.exports = withNativeWind(config, { input: "./global.css" });
