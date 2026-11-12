// Тестове на чистата логика: node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CATS, makeTask, toggleTask, rollAspasia, isBridgeKey, makeBridgeKey, sanitizeBridgeOp,
  applyBridgeOp, sortInbox, statusDoc, diffStatus
} from '../logic.js';

const T = '2026-11-12', Y = '2026-11-11';

test('категория Аспазия съществува и makeTask я пази', () => {
  assert.equal(CATS.aspasia.name, 'Аспазия');
  assert.equal(makeTask({ title: 'x', cat: 'aspasia' }).cat, 'aspasia');
  assert.equal(makeTask({ title: 'x' }).moved, 0);
  assert.equal(makeTask({ title: 'x', moved: '3' }).moved, 3);
  assert.equal(makeTask({ title: 'x', moved: -2 }).moved, 0);
});

test('rollAspasia мести само отворени, неповтарящи се, с минала дата', () => {
  const list = [
    makeTask({ id: 'a', title: 'a', cat: 'aspasia', date: Y }),
    makeTask({ id: 'b', title: 'b', cat: 'aspasia', date: '2026-10-01', moved: 2 }),
    makeTask({ id: 'c', title: 'c', cat: 'aspasia', date: Y, done: true }),
    makeTask({ id: 'd', title: 'd', cat: 'aspasia', date: Y, repeat: 'daily' }),
    makeTask({ id: 'e', title: 'e', cat: 'aspasia', date: '' }),
    makeTask({ id: 'f', title: 'f', cat: 'aspasia', date: T }),
    makeTask({ id: 'g', title: 'g', cat: 'work', date: Y })
  ];
  const r = rollAspasia(list, T);
  assert.deepEqual(r.map(t => [t.id, t.date, t.moved]), [['a', T, 1], ['b', T, 3]]);
  assert.equal(list[0].date, Y, 'не мутира оригинала');
  assert.deepEqual(rollAspasia(r, T), [], 'второ пускане в същия ден не прави нищо');
});

test('toggleTask запазва moved', () => {
  const t = makeTask({ title: 'x', cat: 'aspasia', moved: 4 });
  assert.equal(toggleTask(t, T).moved, 4);
});

test('ключ за моста: дължина, азбука, уникалност', () => {
  const bytes = n => Uint8Array.from({ length: 32 }, (_, i) => (i * 37 + n) & 255);
  const k = makeBridgeKey(bytes(1));
  assert.equal(k.length, 43);
  assert.ok(isBridgeKey(k));
  assert.notEqual(k, makeBridgeKey(bytes(2)));
  assert.equal(makeBridgeKey(new Uint8Array(32)), 'A'.repeat(43));
  assert.equal(makeBridgeKey(new Uint8Array(32).fill(255)).slice(0, 4), '____');
  assert.ok(!isBridgeKey('short'));
  assert.ok(!isBridgeKey('a/b'.repeat(20)));
});

test('sanitizeBridgeOp приема валидни и отхвърля невалидни', () => {
  const ok = sanitizeBridgeOp({ op: 'add', taskId: 'asp-1', title: 'Обади се', date: T, time: '09:30', cat: 'aspasia', prio: 1, at: '2026-11-12T08:00:00Z' });
  assert.ok(ok.ok);
  assert.equal(ok.op.prio, 1);
  const bad = [
    { op: 'nuke', taskId: 'a' },
    { op: 'add', taskId: 'a/b', title: 'x' },
    { op: 'add', taskId: '', title: 'x' },
    { op: 'add', taskId: 'a' },
    { op: 'add', taskId: 'a', title: '   ' },
    { op: 'add', taskId: 'a', title: 'x'.repeat(201) },
    { op: 'update', taskId: 'a', notes: 'x'.repeat(2001) },
    { op: 'update', taskId: 'a', date: '12.11.2026' },
    { op: 'update', taskId: 'a', date: '2026-13-01' },
    { op: 'update', taskId: 'a', time: '25:00' },
    { op: 'update', taskId: 'a', cat: 'hack' },
    { op: 'update', taskId: 'a', prio: 4 },
    { op: 'update', taskId: 'a', prio: '1' },
    { op: 'update', taskId: 'a', title: 42 }
  ];
  for (const b of bad) assert.equal(sanitizeBridgeOp(b).ok, false, JSON.stringify(b));
  assert.ok(sanitizeBridgeOp({ op: 'update', taskId: 'a', date: '', time: '' }).ok, 'празна дата/час изчиства');
  assert.ok(sanitizeBridgeOp({ op: 'done', taskId: 'a' }).ok);
});

const op = o => sanitizeBridgeOp(o).op;

test('add създава задача Аспазия с дата днес по подразбиране; повторно add не дублира', () => {
  const r = applyBridgeOp(undefined, op({ op: 'add', taskId: 'x1', title: 'Купи мляко' }), T);
  assert.equal(r.save.length, 1);
  const t = r.save[0];
  assert.deepEqual([t.id, t.cat, t.date, t.title, t.done], ['x1', 'aspasia', T, 'Купи мляко', false]);
  // Втори път същата операция: същото id, без нова задача.
  const done = { ...t, done: true, doneAt: T };
  const r2 = applyBridgeOp(done, op({ op: 'add', taskId: 'x1', title: 'Купи мляко' }), T);
  assert.equal(r2.save.length, 1);
  assert.equal(r2.save[0].id, 'x1');
  assert.equal(r2.save[0].done, true, 'повторно add не отваря отново изпълнена задача');
});

test('update сменя само подадените полета; update на липсваща е no-op', () => {
  const t = makeTask({ id: 'x1', title: 'A', notes: 'n', cat: 'aspasia', date: T, prio: 2, moved: 2 });
  const r = applyBridgeOp(t, op({ op: 'update', taskId: 'x1', time: '10:00', prio: 1 }), T);
  const u = r.save[0];
  assert.deepEqual([u.title, u.notes, u.time, u.prio, u.moved, u.cat], ['A', 'n', '10:00', 1, 2, 'aspasia']);
  assert.deepEqual(applyBridgeOp(undefined, op({ op: 'update', taskId: 'zz', title: 'Q' }), T), { save: [], remove: null });
});

test('done/undone сменят done и doneAt и са идемпотентни', () => {
  const t = makeTask({ id: 'x1', title: 'A', cat: 'aspasia', date: T });
  const d = applyBridgeOp(t, op({ op: 'done', taskId: 'x1' }), T).save[0];
  assert.deepEqual([d.done, d.doneAt], [true, T]);
  assert.deepEqual(applyBridgeOp(d, op({ op: 'done', taskId: 'x1' }), T).save, [], 'второ done не прави нищо');
  const u = applyBridgeOp(d, op({ op: 'undone', taskId: 'x1' }), T).save[0];
  assert.deepEqual([u.done, u.doneAt], [false, '']);
  assert.deepEqual(applyBridgeOp(u, op({ op: 'undone', taskId: 'x1' }), T).save, []);
  assert.deepEqual(applyBridgeOp(undefined, op({ op: 'done', taskId: 'none' }), T).save, []);
});

test('done на повтаряща се: прехвърля и оставя копие в историята', () => {
  const t = makeTask({ id: 'r', title: 'R', cat: 'aspasia', date: T, repeat: 'daily' });
  const r = applyBridgeOp(t, op({ op: 'done', taskId: 'r' }), T);
  assert.equal(r.save.length, 2);
  assert.equal(r.save[0].id, 'r');
  assert.equal(r.save[0].date, '2026-11-13');
  assert.equal(r.save[1].done, true);
});

test('delete премахва само съществуваща', () => {
  const t = makeTask({ id: 'x1', title: 'A' });
  assert.equal(applyBridgeOp(t, op({ op: 'delete', taskId: 'x1' }), T).remove, 'x1');
  assert.equal(applyBridgeOp(undefined, op({ op: 'delete', taskId: 'x1' }), T).remove, null);
});

test('последователност add → update → done от една опашка, подредена по at', () => {
  const inbox = sortInbox([
    { id: 'm3', op: 'done', taskId: 'k', at: '2026-11-12T08:00:03Z' },
    { id: 'm1', op: 'add', taskId: 'k', title: 'K', at: '2026-11-12T08:00:01Z' },
    { id: 'm2', op: 'update', taskId: 'k', time: '11:00', at: '2026-11-12T08:00:02Z' }
  ]);
  assert.deepEqual(inbox.map(d => d.id), ['m1', 'm2', 'm3']);
  let list = [];
  for (const d of [...inbox, ...inbox]) {               // всичко получено два пъти
    const v = sanitizeBridgeOp(d); assert.ok(v.ok);
    const r = applyBridgeOp(list.find(t => t.id === v.op.taskId), v.op, T);
    for (const t of r.save) { const i = list.findIndex(x => x.id === t.id); i >= 0 ? (list[i] = t) : list.push(t); }
  }
  assert.equal(list.length, 1);
  assert.deepEqual([list[0].time, list[0].done], ['11:00', true]);
});

test('diffStatus: пише само Аспазия и само при промяна, трие липсващите', () => {
  const a = makeTask({ id: 'a', title: 'A', cat: 'aspasia', date: T, moved: 1 });
  const b = makeTask({ id: 'b', title: 'B', cat: 'aspasia', date: T });
  const w = makeTask({ id: 'w', title: 'W', cat: 'work', date: T });
  const status = [{ id: 'a', ...statusDoc(a), updated: 'old' }, { id: 'gone', title: 'G' }, { id: 'w', title: 'W' }];
  const r = diffStatus([a, b, w], status, 'NOW');
  assert.deepEqual(r.writes, [{ id: 'b', data: { title: 'B', date: T, time: '', done: false, doneAt: '', moved: 0, updated: 'NOW' } }]);
  assert.deepEqual(r.deletes.sort(), ['gone', 'w']);
  const r2 = diffStatus([{ ...a, done: true, doneAt: T }], [{ id: 'a', ...statusDoc(a) }], 'NOW');
  assert.equal(r2.writes.length, 1);
  assert.equal(r2.writes[0].data.done, true);
});
