/**
 * Canonical sdkwork-iam workspace-relative paths for consumer repositories.
 * See DEPENDENCY_MANAGEMENT_SPEC.md §3.1 and IAM_SPEC.md package placement rules.
 */

export const SDKWORK_IAM_REPO = 'sdkwork-iam';

export const IAM_COMMON_PACKAGES = 'apps/sdkwork-iam-common/packages';
export const IAM_PC_PACKAGES = 'apps/sdkwork-iam-pc/packages';

export const IAM_PACKAGE_PATHS = {
  '@sdkwork/iam-contracts': `${IAM_COMMON_PACKAGES}/sdkwork-iam-contracts`,
  '@sdkwork/iam-runtime': `${IAM_COMMON_PACKAGES}/sdkwork-iam-runtime`,
  '@sdkwork/iam-service': `${IAM_COMMON_PACKAGES}/sdkwork-iam-service`,
  '@sdkwork/iam-sdk-ports': `${IAM_COMMON_PACKAGES}/sdkwork-iam-sdk-ports`,
  '@sdkwork/iam-sdk-adapter': `${IAM_COMMON_PACKAGES}/sdkwork-iam-sdk-adapter`,
  '@sdkwork/iam-application-bootstrap': `${IAM_COMMON_PACKAGES}/sdkwork-iam-application-bootstrap`,
  '@sdkwork/iam-rpc-contracts': `${IAM_COMMON_PACKAGES}/sdkwork-iam-rpc-contracts`,
  '@sdkwork/iam-desktop-auth': `${IAM_COMMON_PACKAGES}/sdkwork-iam-desktop-auth`,
  '@sdkwork/auth-pc-react': `${IAM_PC_PACKAGES}/sdkwork-auth-pc-react`,
  '@sdkwork/auth-runtime-pc-react': `${IAM_PC_PACKAGES}/sdkwork-auth-runtime-pc-react`,
  '@sdkwork/iam-react': `${IAM_PC_PACKAGES}/sdkwork-iam-react`,
  '@sdkwork/iam-core-pc-react': `${IAM_PC_PACKAGES}/sdkwork-iam-core-pc-react`,
};

export const IAM_SDK_PATHS = {
  '@sdkwork/iam-app-sdk':
    'sdks/sdkwork-iam-app-sdk/sdkwork-iam-app-sdk-typescript',
  '@sdkwork/iam-backend-sdk':
    'sdks/sdkwork-iam-backend-sdk/sdkwork-iam-backend-sdk-typescript',
  '@sdkwork/iam-open-sdk':
    'sdks/sdkwork-iam-open-sdk/sdkwork-iam-open-sdk-typescript',
};

/** pnpm-workspace.yaml entries relative to consuming repo root (sibling layout). */
export const IAM_PNPM_WORKSPACE_PACKAGES = [
  `../${SDKWORK_IAM_REPO}/${IAM_COMMON_PACKAGES}/sdkwork-iam-contracts`,
  `../${SDKWORK_IAM_REPO}/${IAM_COMMON_PACKAGES}/sdkwork-iam-runtime`,
  `../${SDKWORK_IAM_REPO}/${IAM_COMMON_PACKAGES}/sdkwork-iam-sdk-ports`,
  `../${SDKWORK_IAM_REPO}/${IAM_COMMON_PACKAGES}/sdkwork-iam-sdk-adapter`,
  `../${SDKWORK_IAM_REPO}/${IAM_COMMON_PACKAGES}/sdkwork-iam-service`,
  `../${SDKWORK_IAM_REPO}/${IAM_COMMON_PACKAGES}/sdkwork-iam-application-bootstrap`,
  // `sdkwork-auth-pc-react` depends on the desktop auth adapter via
  // `workspace:*`; without this entry the closure is uninstallable
  // (ERR_PNPM_WORKSPACE_PKG_NOT_FOUND).
  `../${SDKWORK_IAM_REPO}/${IAM_COMMON_PACKAGES}/sdkwork-iam-desktop-auth`,
  `../${SDKWORK_IAM_REPO}/${IAM_PC_PACKAGES}/sdkwork-auth-pc-react`,
  `../${SDKWORK_IAM_REPO}/${IAM_PC_PACKAGES}/sdkwork-auth-runtime-pc-react`,
  `../${SDKWORK_IAM_REPO}/${IAM_PC_PACKAGES}/sdkwork-iam-react`,
  `../${SDKWORK_IAM_REPO}/sdks/sdkwork-iam-app-sdk/sdkwork-iam-app-sdk-typescript`,
  `../${SDKWORK_IAM_REPO}/sdks/sdkwork-iam-backend-sdk/sdkwork-iam-backend-sdk-typescript`,
  `../${SDKWORK_IAM_REPO}/sdks/sdkwork-iam-open-sdk/sdkwork-iam-open-sdk-typescript`,
];

export const LEGACY_IAM_COMMON_PREFIX = 'packages/common/iam';
export const LEGACY_IAM_PC_PREFIX = 'packages/pc-react/iam';

export function joinIamRepoPath(...segments) {
  return [SDKWORK_IAM_REPO, ...segments].join('/');
}

export function iamPackageSourceEntry(packageDir, entry = 'src/index.ts') {
  return `${IAM_COMMON_PACKAGES}/${packageDir}/${entry}`.replace(
    `${IAM_COMMON_PACKAGES}/sdkwork-auth`,
    `${IAM_PC_PACKAGES}/sdkwork-auth`,
  );
}
