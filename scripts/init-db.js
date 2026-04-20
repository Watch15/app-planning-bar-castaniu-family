const { MongoClient } = require('mongodb');
require('dotenv').config();

async function main() {
    const client = new MongoClient(process.env.MONGO_URI);
    try {
        await client.connect();
        const db = client.db('gestion_bar');

        await db.collection('establishments').deleteMany({});
        await db.collection('staff').deleteMany({});
        await db.collection('shifts').deleteMany({});
        await db.collection('users').deleteMany({});
        await db.collection('sessions').deleteMany({});

        await db.collection('establishments').insertMany([
            { id: 'Josy_pub',          name: 'Josy',   type: 'pub',        hours: { open: 10, close: 26 } },
            { id: 'Poni_restaurant',   name: 'Poni',   type: 'restaurant', hours: { open: 10, close: 26 } },
            { id: 'FanFan_restaurant', name: 'FanFan', type: 'restaurant', hours: { open: 10, close: 26 } },
            { id: 'Caval_restaurant',  name: 'Caval',  type: 'restaurant', hours: { open: 10, close: 26 } },
        ]);
        console.log('✅ 4 établissements créés');

        await db.collection('staff').insertMany([
            { name: 'Julien', color: '#3498db', email: '' },
            { name: 'Marc',   color: '#9b59b6', email: '' },
            { name: 'Sophie', color: '#e67e22', email: '' },
        ]);
        console.log('✅ 3 membres du staff créés');
        
        // Supprimer les indexes existants (sauf _id) avant de les recréer
        const collections = [
            'establishments', 'staff', 'shifts', 'users',
            'sessions', 'availabilities', 'push_subscriptions',
            'notifications', 'shift_swaps', 'settings', 'roles'
        ];
        for (const col of collections) {
            try {
                await db.collection(col).dropIndexes();
            } catch (e) {
                // Collection inexistante — on ignore
            }
        }

        await db.collection('establishments').createIndex({ id: 1 }, { unique: true });
        await db.collection('shifts').createIndex({ establishment_id: 1, date: 1 });
        await db.collection('shifts').createIndex({ staff_id: 1, date: 1 });
        await db.collection('users').createIndex({ email: 1 }, { unique: true, sparse: true });
        await db.collection('users').createIndex({ phone: 1 }, { sparse: true });
        await db.collection('users').createIndex({ invite_token: 1 }, { sparse: true });
        await db.collection('users').createIndex({ reset_token: 1 }, { sparse: true });
        await db.collection('users').createIndex({ staff_id: 1 }, { sparse: true });
        await db.collection('sessions').createIndex({ sid: 1 }, { unique: true });
        await db.collection('sessions').createIndex({ expires: 1 }, { expireAfterSeconds: 0 });
        await db.collection('availabilities').createIndex({ staff_id: 1, date: 1 });
        await db.collection('availabilities').createIndex({ date: 1, status: 1 });
        await db.collection('availabilities').createIndex({ status: 1 });
        await db.collection('push_subscriptions').createIndex({ user_id: 1 });
        await db.collection('notifications').createIndex({ user_id: 1, read: 1, created_at: -1 });
        await db.collection('shift_swaps').createIndex({ status: 1, created_at: -1 });
        await db.collection('shift_swaps').createIndex({ from_staff_id: 1 });
        await db.collection('shift_swaps').createIndex({ to_staff_id: 1 });
        await db.collection('settings').createIndex({ key: 1 }, { unique: true });
        await db.collection('roles').createIndex({ type: 1, name: 1 });
        console.log('✅ Index créés');
        // Paramètres par défaut : saisie ouverte
        await db.collection('settings').updateOne(
            { key: 'dispo' },
            { $setOnInsert: { key: 'dispo', open: true, message: null } },
            { upsert: true }
        );
        console.log('\n⚠️  Lance ensuite : npm run create-patron');
    } catch (e) {
        console.error('❌ Erreur :', e.message);
    } finally {
        await client.close();
    }
}

main();