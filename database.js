import dotenv from "dotenv";
import { Sequelize } from "sequelize";

dotenv.config({ quiet: true });

let sequelize;

const databaseUrl = process.env.DATABASE_URL?.trim();

if (process.env.MODE_NODE === "dev" || !databaseUrl) {
    sequelize = new Sequelize({
        dialect: "sqlite",
        storage: "database.sqlite",
        logging: false
    });
} else {
    sequelize = new Sequelize(
        databaseUrl,
        {
            dialect: "postgres",
            dialectOptions: {
                ssl: {
                    require: true,
                    rejectUnauthorized: false
                }
            },
            logging: false
        }
    );
}

