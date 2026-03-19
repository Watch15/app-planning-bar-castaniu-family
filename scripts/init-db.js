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

        await db.collection('establishments').insertMany([
            { id: 'Josy_pub',          name: 'Josy',   type: 'pub',        hours: { open: 12, close: 26 } },
            { id: 'Poni_restaurant',   name: 'Poni',   type: 'restaurant', hours: { open: 12, close: 24 } },
            { id: 'FanFan_restaurant', name: 'FanFan', type: 'restaurant', hours: { open: 12, close: 24 } },
            { id: 'Caval_restaurant',  name: 'Caval',  type: 'restaurant', hours: { open: 12, close: 26 } },
        ]);
        console.log('✅ 4 établissements créés');

        await db.collection('staff').insertMany([
            { name: 'Julien', color: '#3498db' },
            { name: 'Marc',   color: '#9b59b6' },
            { name: 'Sophie', color: '#e67e22' },
        ]);
        console.log('✅ 3 membres du staff créés');

        // Index
        await db.collection('establishments').createIndex({ id: 1 }, { unique: true });
        // Index composé : establishment + date pour charger un jour précis rapidement
        await db.collection('shifts').createIndex({ establishment_id: 1, date: 1 });
        await db.collection('shifts').createIndex({ staff_id: 1 });
        await db.collection('users').createIndex({ email: 1 }, { unique: true });
        await db.collection('sessions').createIndex({ expires: 1 }, { expireAfterSeconds: 0 });
        console.log('✅ Index créés');

        console.log('\n⚠️  Pour créer le compte patron, lance : npm run create-patron');

        console.log('\n📋 Nouveau schéma shift :');
        console.log('   { staff_id, staff_name, establishment_id, date: "YYYY-MM-DD", start_time, end_time, color }');

    } catch (e) {
        console.error('❌ Erreur :', e.message);
    } finally {
        await client.close();
    }
}

main();
