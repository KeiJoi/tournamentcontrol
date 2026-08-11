#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const projectPath = resolve(root, "apps/dalamud/TournamentControl.Dalamud.csproj");
const defaultRepoUrl = "https://github.com/KeiJoi/tournamentcontrol";

function option(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

function value(xml, property) {
  const match = xml.match(new RegExp(`<${property}>([^<]+)</${property}>`));
  if (!match) throw new Error(`Missing <${property}> in ${projectPath}.`);
  return match[1].trim();
}

function assemblyVersion(version) {
  if (!/^\d+\.\d+\.\d+$/.test(version)) {
    throw new Error(`Version must be a three-part stable semantic version; received ${version}.`);
  }
  return `${version}.0`;
}

const project = await readFile(projectPath, "utf8");
const metadata = {
  version: value(project, "Version"),
  author: value(project, "Author"),
  name: value(project, "Name"),
  internalName: value(project, "InternalName"),
  punchline: value(project, "Punchline"),
  description: value(project, "Description"),
  apiLevel: Number(value(project, "MinimumDalamudVersion").split(".")[0]),
};

if (!Number.isInteger(metadata.apiLevel) || metadata.apiLevel < 1) {
  throw new Error("MinimumDalamudVersion must begin with a positive API level.");
}

const tag = option("--tag") ?? `v${metadata.version}`;
if (tag !== `v${metadata.version}`) {
  throw new Error(`Tag ${tag} does not match the authoritative project version v${metadata.version}.`);
}

const repoUrl = option("--repo-url") ?? defaultRepoUrl;
const output = option("--output");
const lastUpdate = option("--last-update") ?? "0";
if (!/^\d+$/.test(lastUpdate)) throw new Error("--last-update must be a Unix timestamp in seconds.");

const assetName = `TournamentBracketController-v${metadata.version}.zip`;
const assetUrl = `${repoUrl}/releases/download/${tag}/${assetName}`;
const entry = {
  Author: metadata.author,
  Name: metadata.name,
  InternalName: metadata.internalName,
  AssemblyVersion: assemblyVersion(metadata.version),
  TestingAssemblyVersion: null,
  RepoUrl: repoUrl,
  ApplicableVersion: "any",
  DalamudApiLevel: metadata.apiLevel,
  TestingDalamudApiLevel: null,
  Punchline: metadata.punchline,
  Description: metadata.description,
  IsHide: false,
  IsTestingExclusive: false,
  DownloadCount: 0,
  DownloadLinkInstall: assetUrl,
  DownloadLinkTesting: assetUrl,
  DownloadLinkUpdate: assetUrl,
  LastUpdate: lastUpdate,
};

const json = `${JSON.stringify([entry], null, 2)}\n`;
if (output) {
  const path = resolve(root, output);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, json, "utf8");
} else {
  process.stdout.write(json);
}
