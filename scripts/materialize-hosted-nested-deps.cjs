/**
 * n8n 社区节点在安装后常将传递依赖 hoist 到包根甚至 ~/.n8n/nodes/node_modules，
 * n8n 加载时却仍按 「宿主/node_modules/<子包>/…」读取（如 @n8n/ai-utilities → js-tiktoken）。
 *
 * 对 package.json 的 dependencies 以及「已安装在本包 node_modules 下」的 peerDependencies
 * （如 n8n-workflow）逐个作为宿主物化其依赖闭包；
 * 另扫描本包 node_modules 顶层已安装的全部包（生产安装一般为依赖闭包，
 * 可覆盖 loader 指向的深层宿主如 langchain、openai 等）。
 * 「宿主目录/node_modules/」下：
 * - 默认：symlink（失败则拷贝）
 * - --copy-for-publish：递归拷贝（发版 tarball 内含物理目录，且不依赖 postinstall）
 *
 * 由 postinstall / npx node / register-*.ts 首次 require；CLI 与本包 require.main 时每进程一次守护。
 */
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const rootPackageJsonPath = path.join(root, "package.json");
const rootNodeModules = path.join(root, "node_modules");
const peerNodeModules = path.dirname(root);

const copyForPublish = process.argv.includes("--copy-for-publish");
const RUN_GUARD_KEY = "__matrees_n8n_materialize_hosted_nested_deps_v6";

function readPackageJson(packageJsonAbs) {
	return JSON.parse(fs.readFileSync(packageJsonAbs, "utf8"));
}

function localPackageDirUnderRootNodeModules(pkgName) {
	if (pkgName.startsWith("@") && pkgName.includes("/")) {
		const [scope, leaf] = pkgName.split("/");
		return path.join(rootNodeModules, scope, leaf);
	}
	return path.join(rootNodeModules, pkgName);
}

function enumerateTopLevelInstalledPackageNames() {
	const out = new Set();
	let entries;
	try {
		entries = fs.readdirSync(rootNodeModules, { withFileTypes: true });
	} catch {
		return [...out];
	}
	const readNameInto = (pkgDirAbs, sink) => {
		const pj = path.join(pkgDirAbs, "package.json");
		try {
			if (!fs.existsSync(pj)) return;
			const parsed = readPackageJson(pj);
			if (typeof parsed.name === "string") {
				sink.add(parsed.name);
			}
		} catch {
			// ignore
		}
	};
	for (const ent of entries) {
		if (!ent.isDirectory() || ent.name === ".bin" || ent.name.startsWith(".")) continue;
		const base = path.join(rootNodeModules, ent.name);
		if (ent.name.startsWith("@")) {
			let subs;
			try {
				subs = fs.readdirSync(base, { withFileTypes: true });
			} catch {
				continue;
			}
			for (const sub of subs) {
				if (!sub.isDirectory()) continue;
				readNameInto(path.join(base, sub.name), out);
			}
		} else {
			readNameInto(base, out);
		}
	}
	return [...out];
}

function getHostPackageNames() {
	try {
		const pj = readPackageJson(rootPackageJsonPath);
		const names = new Set(Object.keys(pj.dependencies || {}));
		for (const peerName of Object.keys(pj.peerDependencies || {})) {
			if (names.has(peerName)) continue;
			const cand = localPackageDirUnderRootNodeModules(peerName);
			try {
				if (fs.existsSync(path.join(cand, "package.json"))) {
					names.add(peerName);
				}
			} catch {
				continue;
			}
		}
		for (const nm of enumerateTopLevelInstalledPackageNames()) {
			names.add(nm);
		}
		return [...names];
	} catch {
		return [];
	}
}

function getDefaultForestRoots() {
	const candidates = [rootNodeModules, peerNodeModules];
	const seen = new Set();
	const out = [];
	for (const c of candidates) {
		const abs = path.resolve(c);
		if (seen.has(abs)) continue;
		seen.add(abs);
		try {
			if (fs.existsSync(abs) && fs.statSync(abs).isDirectory()) {
				out.push(abs);
			}
		} catch {
			continue;
		}
	}
	return out;
}

function linkPathInsideNestedBase(nestedBaseAbs, pkgName) {
	if (pkgName.startsWith("@") && pkgName.includes("/")) {
		const [scope, leaf] = pkgName.split("/");
		return path.join(nestedBaseAbs, scope, leaf);
	}
	return path.join(nestedBaseAbs, pkgName);
}

function directPackageUnderNodeModules(nmAbs, pkgName) {
	if (pkgName.startsWith("@") && pkgName.includes("/")) {
		const [scope, leaf] = pkgName.split("/");
		return path.join(nmAbs, scope, leaf);
	}
	return path.join(nmAbs, pkgName);
}

function findDeepInRoots(pkgName, nmRoots) {
	const visitedNm = new Set();

	function recurse(nmAbs) {
		if (visitedNm.has(nmAbs)) return null;
		visitedNm.add(nmAbs);

		const candidate = directPackageUnderNodeModules(nmAbs, pkgName);
		try {
			if (fs.existsSync(path.join(candidate, "package.json"))) {
				return candidate;
			}
		} catch {
			return null;
		}

		let entries;
		try {
			entries = fs.readdirSync(nmAbs, { withFileTypes: true });
		} catch {
			return null;
		}

		for (const ent of entries) {
			if (!ent.isDirectory() || ent.name === ".bin") continue;
			const sub = path.join(nmAbs, ent.name);
			const childNm = path.join(sub, "node_modules");
			try {
				if (fs.existsSync(childNm)) {
					const found = recurse(childNm);
					if (found) return found;
				}
			} catch {
				continue;
			}
		}
		return null;
	}

	const uniqRoots = [...new Set(nmRoots.map((r) => path.resolve(r)))];
	for (const nmRoot of uniqRoots) {
		try {
			if (!fs.existsSync(nmRoot)) continue;
			const hit = recurse(nmRoot);
			if (hit) return hit;
		} catch {
			continue;
		}
	}
	return null;
}

function resolveHintsToModuleDirs(searchRoots) {
	const uniqRoots = [...new Set((searchRoots || []).filter(Boolean).map((p) => path.resolve(p)))];
	const moduleDirs = uniqRoots.flatMap((r) =>
		path.basename(r) === "node_modules"
			? [r]
			: fs.existsSync(path.join(r, "node_modules"))
				? [path.join(r, "node_modules")]
				: [r],
	);
	return [...new Set(moduleDirs)].filter((d) => {
		try {
			return fs.existsSync(d);
		} catch {
			return false;
		}
	});
}

function resolveWithOrderedModuleRoots(pkgName, orderedRoots) {
	for (const nm of orderedRoots) {
		try {
			if (!nm || !fs.existsSync(nm)) continue;
			const nmAbs = path.resolve(nm);
			const candidate = directPackageUnderNodeModules(nmAbs, pkgName);
			try {
				if (fs.existsSync(path.join(candidate, "package.json"))) {
					return candidate;
				}
			} catch {
				continue;
			}
			try {
				return path.dirname(
					require.resolve(`${pkgName}/package.json`, {
						paths: [nmAbs],
					}),
				);
			} catch {
				continue;
			}
		} catch {
			continue;
		}
	}
	return findDeepInRoots(pkgName, orderedRoots);
}

/** 物化嵌套依赖时必须先查「当前宿主」自己的 node_modules，否则会链到根上被 hoist 的错误版本（典型：uuid）。 */
function resolveInstalledDirPreferHost(pkgName, hostRootAbs) {
	const ordered = [];
	const hostNm = path.join(path.resolve(hostRootAbs), "node_modules");
	if (fs.existsSync(hostNm)) {
		ordered.push(hostNm);
	}
	for (const d of getDefaultForestRoots()) {
		const a = path.resolve(d);
		if (!ordered.includes(a)) {
			ordered.push(a);
		}
	}
	return resolveWithOrderedModuleRoots(pkgName, ordered);
}

function resolveInstalledDir(pkgName, searchRoots) {
	const forest = [...new Set([...resolveHintsToModuleDirs(searchRoots), ...getDefaultForestRoots()])];
	return resolveWithOrderedModuleRoots(pkgName, forest);
}

function rmrfSilently(p) {
	try {
		fs.rmSync(p, { recursive: true, force: true });
	} catch {
		// ignore
	}
}

function getUuidCjsEntryRelative(pkgRootAbs) {
	let pj;
	try {
		pj = readPackageJson(path.join(pkgRootAbs, "package.json"));
	} catch {
		return null;
	}
	if (pj.name !== "uuid") {
		return null;
	}
	const exp = pj.exports;
	if (exp && typeof exp === "object" && exp["."]) {
		const sub = exp["."];
		if (sub && typeof sub === "object" && typeof sub.require === "string") {
			return sub.require.replace(/^\.\//, "");
		}
	}
	if (typeof pj.main === "string") {
		return pj.main.replace(/^\.\//, "");
	}
	return null;
}

/**
 * n8n / 旧代码硬编码 require('.../uuid/dist/index.js')；uuid@11+ 可能无此文件。
 * 仅在社区包目录树内写入薄 shim，避免改全局 store。
 */
function ensureUuidDistIndexShim(uuidRootAbs) {
	const rootResolved = path.resolve(root) + path.sep;
	let realBase;
	try {
		realBase = fs.realpathSync(uuidRootAbs);
	} catch {
		return;
	}
	if (!realBase.startsWith(rootResolved)) {
		return;
	}
	const distIndex = path.join(realBase, "dist", "index.js");
	try {
		if (fs.existsSync(distIndex)) {
			return;
		}
	} catch {
		return;
	}
	const entryRel = getUuidCjsEntryRelative(realBase);
	if (!entryRel) {
		return;
	}
	const entryAbs = path.join(realBase, entryRel);
	try {
		if (!fs.existsSync(entryAbs)) {
			return;
		}
	} catch {
		return;
	}
	try {
		fs.mkdirSync(path.dirname(distIndex), { recursive: true });
		const rel = path.relative(path.dirname(distIndex), entryAbs).replace(/\\/g, "/");
		const reqPath = rel.startsWith(".") ? rel : `./${rel}`;
		fs.writeFileSync(distIndex, `"use strict";\nmodule.exports = require(${JSON.stringify(reqPath)});\n`);
	} catch {
		// ignore
	}
}

function ensureNestedLink(nestedBaseAbs, pkgName, hostRootAbs) {
	const linkPath = linkPathInsideNestedBase(nestedBaseAbs, pkgName);
	if (!copyForPublish) {
		try {
			if (fs.existsSync(linkPath)) {
				if (pkgName === "uuid") {
					const distIndexEarly = path.join(linkPath, "dist", "index.js");
					if (!fs.existsSync(distIndexEarly)) {
						const fixed = resolveInstalledDirPreferHost(pkgName, hostRootAbs);
						if (fixed && path.resolve(fixed) !== path.resolve(linkPath)) {
							try {
								rmrfSilently(linkPath);
								fs.cpSync(fixed, linkPath, { recursive: true });
							} catch {
								// ignore
							}
						}
					}
					ensureUuidDistIndexShim(linkPath);
				}
				return;
			}
		} catch {
			return;
		}
	}

	const resolvedDir = resolveInstalledDirPreferHost(pkgName, hostRootAbs);
	if (!resolvedDir) {
		return;
	}

	if (path.resolve(resolvedDir) === path.resolve(linkPath)) {
		if (pkgName === "uuid") {
			ensureUuidDistIndexShim(linkPath);
		}
		return;
	}

	try {
		fs.mkdirSync(path.dirname(linkPath), { recursive: true });
		if (copyForPublish) {
			rmrfSilently(linkPath);
			fs.cpSync(resolvedDir, linkPath, { recursive: true });
			if (pkgName === "uuid") {
				ensureUuidDistIndexShim(linkPath);
			}
			return;
		}
		const rel = path.relative(path.dirname(linkPath), resolvedDir);
		fs.symlinkSync(rel, linkPath, "dir");
		if (pkgName === "uuid") {
			ensureUuidDistIndexShim(linkPath);
		}
	} catch {
		try {
			rmrfSilently(linkPath);
			fs.cpSync(resolvedDir, linkPath, { recursive: true });
			if (pkgName === "uuid") {
				ensureUuidDistIndexShim(linkPath);
			}
		} catch {
			// ignore
		}
	}
}

function materializeSingleHostClosure(hostRootAbs) {
	const nestedBase = path.join(hostRootAbs, "node_modules");
	let hostPkg;
	try {
		hostPkg = readPackageJson(path.join(hostRootAbs, "package.json"));
	} catch {
		return;
	}

	const seed = Object.keys(hostPkg.dependencies || {}).concat(Object.keys(hostPkg.optionalDependencies || {}));

	const queue = [];
	const queued = new Set();
	for (const s of seed) {
		if (!queued.has(s)) {
			queued.add(s);
			queue.push(s);
		}
	}

	const processed = new Set();

	while (queue.length) {
		const name = queue.shift();
		if (!name || processed.has(name)) continue;
		processed.add(name);

		ensureNestedLink(nestedBase, name, hostRootAbs);

		const resolvedDir = resolveInstalledDirPreferHost(name, hostRootAbs);
		if (!resolvedDir) {
			continue;
		}

		let subPkg;
		try {
			subPkg = readPackageJson(path.join(resolvedDir, "package.json"));
		} catch {
			continue;
		}

		const nextDeps = Object.assign(
			{},
			subPkg.dependencies || {},
			subPkg.optionalDependencies || {},
		);
		for (const dep of Object.keys(nextDeps)) {
			if (!queued.has(dep)) {
				queued.add(dep);
				queue.push(dep);
			}
		}
	}
}

function materializeAllHosts() {
	const hosts = getHostPackageNames();
	const seenHostRoot = new Set();
	for (const hostPkgName of hosts) {
		const hostRootAbs = resolveInstalledDir(hostPkgName, [rootNodeModules, peerNodeModules]);
		if (!hostRootAbs) {
			continue;
		}
		const key = path.resolve(hostRootAbs);
		if (seenHostRoot.has(key)) continue;
		seenHostRoot.add(key);
		materializeSingleHostClosure(hostRootAbs);
	}
}

function maybeRunMaterializeCycle() {
	if (require.main === module) {
		materializeAllHosts();
		return;
	}
	if (!copyForPublish && globalThis[RUN_GUARD_KEY]) {
		return;
	}
	materializeAllHosts();
	globalThis[RUN_GUARD_KEY] = true;
}

maybeRunMaterializeCycle();
