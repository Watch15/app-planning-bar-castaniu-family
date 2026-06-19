'use strict';
// Mini base Mongo en mémoire pour les tests d'intégration de routes (CD-05).
// Implémente UNIQUEMENT ce que les routes testées utilisent : findOne, find().toArray(),
// insertOne, deleteMany, updateOne (avec upsert/$set/$pull), bulkWrite (updateOne+upsert),
// countDocuments — et les opérateurs $ne/$lte/$gte/$lt/$gt/$in. Pas un clone fidèle de
// Mongo : juste assez pour piloter la logique métier sans serveur réel.

function isObjId(x) {
    return x && typeof x === 'object' && typeof x.toHexString === 'function';
}

// Égalité tolérante : ObjectId vs hex string, Date vs Date, sinon strict.
function eq(a, b) {
    if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
    if (isObjId(a) || isObjId(b)) return String(a) === String(b);
    return a === b;
}

function isOperator(cond) {
    return cond !== null && typeof cond === 'object' && !Array.isArray(cond)
        && !(cond instanceof Date) && !isObjId(cond)
        && Object.keys(cond).every(k => k.startsWith('$'));
}

function matchField(val, cond) {
    if (isOperator(cond)) {
        return Object.entries(cond).every(([op, v]) => {
            switch (op) {
                case '$ne':  return !eq(val, v);
                case '$lte': return val <= v;
                case '$gte': return val >= v;
                case '$lt':  return val < v;
                case '$gt':  return val > v;
                case '$in':  return Array.isArray(v) && v.some(x => eq(val, x));
                case '$nin': return Array.isArray(v) && !v.some(x => eq(val, x));
                default:     throw new Error('fake-db: opérateur non supporté ' + op);
            }
        });
    }
    return eq(val, cond);
}

function matchDoc(doc, query) {
    return Object.entries(query || {}).every(([k, cond]) => matchField(doc[k], cond));
}

// Champs d'égalité simple d'un filtre (sert à construire un doc upserté).
function plainEq(query) {
    const out = {};
    for (const [k, v] of Object.entries(query || {})) if (!isOperator(v)) out[k] = v;
    return out;
}

function makeCollection(initialDocs) {
    const docs = (initialDocs || []).map(d => ({ ...d }));
    return {
        _docs: docs,
        async findOne(query)      { return docs.find(d => matchDoc(d, query)) || null; },
        find(query)               {
            const res = docs.filter(d => matchDoc(d, query));
            return { sort() { return this; }, limit() { return this; }, async toArray() { return res.slice(); } };
        },
        async insertOne(doc)      { docs.push({ ...doc }); return { insertedId: doc._id || null, acknowledged: true }; },
        async countDocuments(q)   { return docs.filter(d => matchDoc(d, q || {})).length; },
        async deleteMany(query)   {
            let n = 0;
            for (let i = docs.length - 1; i >= 0; i--) if (matchDoc(docs[i], query)) { docs.splice(i, 1); n++; }
            return { deletedCount: n };
        },
        async updateOne(query, update, opts) {
            const idx = docs.findIndex(d => matchDoc(d, query));
            if (idx >= 0) {
                if (update.$set)  Object.assign(docs[idx], update.$set);
                if (update.$pull) for (const [k, v] of Object.entries(update.$pull))
                    if (Array.isArray(docs[idx][k])) docs[idx][k] = docs[idx][k].filter(x => !eq(x, v));
                return { matchedCount: 1, modifiedCount: 1, upsertedCount: 0 };
            }
            if (opts && opts.upsert) {
                docs.push({ ...plainEq(query), ...(update.$setOnInsert || {}), ...(update.$set || {}) });
                return { matchedCount: 0, modifiedCount: 0, upsertedCount: 1 };
            }
            return { matchedCount: 0, modifiedCount: 0, upsertedCount: 0 };
        },
        async bulkWrite(ops) {
            let upsertedCount = 0, modifiedCount = 0, matchedCount = 0;
            for (const op of ops) {
                const { filter, update, upsert } = op.updateOne;
                const idx = docs.findIndex(d => matchDoc(d, filter));
                if (idx >= 0) {
                    matchedCount++;
                    if (update.$set) { Object.assign(docs[idx], update.$set); modifiedCount++; }
                } else if (upsert) {
                    docs.push({ ...plainEq(filter), ...(update.$setOnInsert || {}), ...(update.$set || {}) });
                    upsertedCount++;
                }
            }
            return { upsertedCount, modifiedCount, matchedCount };
        },
    };
}

// makeDb({ collectionName: [docs...] }) → objet { collection(name) }.
function makeDb(seed) {
    const cols = {};
    for (const [name, arr] of Object.entries(seed || {})) cols[name] = makeCollection(arr);
    return {
        collection(name) { return (cols[name] = cols[name] || makeCollection([])); },
    };
}

module.exports = { makeDb };
