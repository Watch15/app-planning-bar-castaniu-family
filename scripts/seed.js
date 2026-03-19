const { MongoClient } = require('mongodb');
require('dotenv').config();

async function run() {
    const client = new MongoClient(process.env.MONGO_URI);
    try {
        await client.connect();
        const db = client.db('gestion_bar');

        await db.collection('shifts').deleteMany({});

        const shifts = [
            // ── Josy (pub) ─────────────────────────────────────────
            { establishment_id: 'Josy_pub',          staff_name: 'Julien',    color: '#3498db', start_time: 18, end_time: 26 },
            { establishment_id: 'Josy_pub',          staff_name: 'Marc',   color: '#9b59b6', start_time: 20, end_time: 26 },
            { establishment_id: 'Josy_pub',          staff_name: 'Sophie', color: '#e67e22', start_time: 18, end_time: 24 },

            // ── Poni (restaurant) ───────────────────────────────────
            { establishment_id: 'Poni_restaurant',   staff_name: 'Julien',    color: '#3498db', start_time: 12, end_time: 16 },
            { establishment_id: 'Poni_restaurant',   staff_name: 'Marc',   color: '#9b59b6', start_time: 12, end_time: 22 },
            { establishment_id: 'Poni_restaurant',   staff_name: 'Sophie',  color: '#e67e22', start_time: 19, end_time: 24 },

            // ── FanFan (restaurant) ─────────────────────────────────
            { establishment_id: 'FanFan_restaurant', staff_name: 'Marc',   color: '#9b59b6', start_time: 12, end_time: 18 },
            { establishment_id: 'FanFan_restaurant', staff_name: 'Sophie',  color: '#e67e22', start_time: 18, end_time: 24 },

            // ── Caval (restaurant) ──────────────────────────────────
            { establishment_id: 'Caval_restaurant',  staff_name: 'Julien',    color: '#3498db', start_time: 19, end_time: 26 },
            { establishment_id: 'Caval_restaurant',  staff_name: 'Sophie',  color: '#e67e22', start_time: 12, end_time: 20 },
        ];

        const result = await db.collection('shifts').insertMany(shifts);
        console.log(`${result.insertedCount} shifts créés`);
    } catch (e) {
        console.error('Erreur :', e.message);
    } finally {
        await client.close();
    }
}

run();