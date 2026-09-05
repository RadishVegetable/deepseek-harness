# Agent Note: Tavern Journeys resolve shared source assets by ID

Status: implemented

English | [中文](2026-09-02-tavern-source-asset-lifecycle.zh.md)

## Problem

Tavern library assets are reusable source documents while Journey logs are durable references. Blocking deletion of every referenced asset prevents replacing an imported document and makes archive state control an unrelated library operation.

## Decision

Tavern selection events persist only Character Card and World Book IDs plus optional player identity. Journey runtime resolves those IDs through the current durable source registry whenever it needs asset data. `deleteAsset` removes an asset from the in-memory and durable source registries without scanning live or archived Session logs. Existing logs remain unchanged. Re-importing the same ID restores resolution; a Journey that requests a missing ID reports that its selected assets are unavailable until the source is restored. Archive state controls history projection and does not pin source library records.

## Alternatives considered

**Persist Journey asset snapshots.** A Journey-owned copy would keep old conversations readable after source deletion, but it would add storage and version semantics that are outside the selected source-reference model. The product uses explicit source IDs so library replacement and re-import remain direct operations.

**Keep reference protection for archived Journeys.** This would protect cold replay at the cost of preventing the library from deleting and re-importing a document. The product allows the explicit recovery path of importing the same ID.

**Delete or rewrite Journey references with the source asset.** Rewriting a durable Session would mutate user history and make archive contents depend on library cleanup. The Session keeps its original selection record, while missing source data remains an explicit resolvable failure.

## Consequences

Source replacement or re-import can change the asset data resolved by existing ID-based Journeys. Deleting a selected source can temporarily make a Journey unavailable; importing the same ID restores it without rewriting the Journey log. Live and archived Journey references do not block source deletion, and the delete operation still restores the in-memory registry when durable deletion fails.

## Verification

Host integration coverage deletes a source asset referenced by an archived Journey and verifies that the deletion remains durable after restart. Existing selection tests continue to cover ID-only `tavern/assets-selected` events and source resolution.
