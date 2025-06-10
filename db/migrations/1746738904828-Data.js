module.exports = class Data1746738904828 {
    name = 'Data1746738904828'

    async up(db) {
        await db.query(`CREATE TABLE "global_config" ("id" character varying NOT NULL, "fee_recipient" text NOT NULL, "fee_basis_points" numeric NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL, "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL, CONSTRAINT "PK_ed2d5f0660208015a2aed745f3a" PRIMARY KEY ("id"))`)
        await db.query(`CREATE TABLE "bonding_curve" ("id" character varying NOT NULL, "virtual_sol_reserves" numeric NOT NULL, "virtual_token_reserves" numeric NOT NULL, "real_sol_reserves" numeric NOT NULL, "real_token_reserves" numeric NOT NULL, "token_total_supply" numeric NOT NULL, "fee_basis_points" numeric NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL, "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL, "token_id" character varying, CONSTRAINT "PK_fc1fee44787a87a8b6bafc1619b" PRIMARY KEY ("id"))`)
        await db.query(`CREATE INDEX "IDX_01f88325b5bdbe310bdae0f25d" ON "bonding_curve" ("token_id") `)
        await db.query(`CREATE TABLE "pump_token" ("id" character varying NOT NULL, "name" text NOT NULL, "symbol" text NOT NULL, "decimals" integer NOT NULL, "creator" text NOT NULL, "status" text NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL, "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL, "bonding_curve_id" character varying, CONSTRAINT "PK_be3f98c1a4ede8d632337887285" PRIMARY KEY ("id"))`)
        await db.query(`CREATE INDEX "IDX_826c7b5eb74ba7c53e25e5f8f6" ON "pump_token" ("bonding_curve_id") `)
        await db.query(`CREATE TABLE "token_created" ("id" character varying NOT NULL, "user" text NOT NULL, "uri" text NOT NULL, "slot" integer NOT NULL, "timestamp" TIMESTAMP WITH TIME ZONE NOT NULL, "token_id" character varying, CONSTRAINT "PK_c468168c94f809f650853656979" PRIMARY KEY ("id"))`)
        await db.query(`CREATE INDEX "IDX_66966e206f5127105764cd3240" ON "token_created" ("token_id") `)
        await db.query(`CREATE TABLE "trade" ("id" character varying NOT NULL, "user" text NOT NULL, "is_buy" boolean NOT NULL, "sol_amount" numeric NOT NULL, "token_amount" numeric NOT NULL, "virtual_sol_reserves" numeric NOT NULL, "virtual_token_reserves" numeric NOT NULL, "real_sol_reserves" numeric NOT NULL, "real_token_reserves" numeric NOT NULL, "slot" integer NOT NULL, "timestamp" TIMESTAMP WITH TIME ZONE NOT NULL, "token_id" character varying, CONSTRAINT "PK_d4097908741dc408f8274ebdc53" PRIMARY KEY ("id"))`)
        await db.query(`CREATE INDEX "IDX_1690d3192769d2b5dab9ba385f" ON "trade" ("token_id") `)
        await db.query(`CREATE TABLE "token_completed" ("id" character varying NOT NULL, "user" text NOT NULL, "slot" integer NOT NULL, "timestamp" TIMESTAMP WITH TIME ZONE NOT NULL, "token_id" character varying, CONSTRAINT "PK_b1bbe2703e280499d322c283c72" PRIMARY KEY ("id"))`)
        await db.query(`CREATE INDEX "IDX_5db49978b80fc779f35063867e" ON "token_completed" ("token_id") `)
        await db.query(`CREATE TABLE "params_updated" ("id" character varying NOT NULL, "fee_recipient" text NOT NULL, "fee_basis_points" numeric NOT NULL, "slot" integer NOT NULL, "timestamp" TIMESTAMP WITH TIME ZONE NOT NULL, "token_id" character varying, CONSTRAINT "PK_9c78d9faeb6ffe81e7eb06f8ad6" PRIMARY KEY ("id"))`)
        await db.query(`CREATE INDEX "IDX_eb1ff8bacab59c47f7d9ce0e81" ON "params_updated" ("token_id") `)
        //await db.query(`ALTER TABLE "bonding_curve" ADD CONSTRAINT "FK_01f88325b5bdbe310bdae0f25d0" FOREIGN KEY ("token_id") REFERENCES "pump_token"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`)
        //await db.query(`ALTER TABLE "pump_token" ADD CONSTRAINT "FK_826c7b5eb74ba7c53e25e5f8f61" FOREIGN KEY ("bonding_curve_id") REFERENCES "bonding_curve"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`)
        //await db.query(`ALTER TABLE "token_created" ADD CONSTRAINT "FK_66966e206f5127105764cd3240c" FOREIGN KEY ("token_id") REFERENCES "pump_token"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`)
        //await db.query(`ALTER TABLE "trade" ADD CONSTRAINT "FK_1690d3192769d2b5dab9ba385fc" FOREIGN KEY ("token_id") REFERENCES "pump_token"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`)
        await db.query(`ALTER TABLE "token_completed" ADD CONSTRAINT "FK_5db49978b80fc779f35063867eb" FOREIGN KEY ("token_id") REFERENCES "pump_token"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`)
        await db.query(`ALTER TABLE "params_updated" ADD CONSTRAINT "FK_eb1ff8bacab59c47f7d9ce0e810" FOREIGN KEY ("token_id") REFERENCES "pump_token"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`)
    }

    async down(db) {
        await db.query(`DROP TABLE "global_config"`)
        await db.query(`DROP TABLE "bonding_curve"`)
        await db.query(`DROP INDEX "public"."IDX_01f88325b5bdbe310bdae0f25d"`)
        await db.query(`DROP TABLE "pump_token"`)
        await db.query(`DROP INDEX "public"."IDX_826c7b5eb74ba7c53e25e5f8f6"`)
        await db.query(`DROP TABLE "token_created"`)
        await db.query(`DROP INDEX "public"."IDX_66966e206f5127105764cd3240"`)
        await db.query(`DROP TABLE "trade"`)
        await db.query(`DROP INDEX "public"."IDX_1690d3192769d2b5dab9ba385f"`)
        await db.query(`DROP TABLE "token_completed"`)
        await db.query(`DROP INDEX "public"."IDX_5db49978b80fc779f35063867e"`)
        await db.query(`DROP TABLE "params_updated"`)
        await db.query(`DROP INDEX "public"."IDX_eb1ff8bacab59c47f7d9ce0e81"`)
       // await db.query(`ALTER TABLE "bonding_curve" DROP CONSTRAINT "FK_01f88325b5bdbe310bdae0f25d0"`)
        //await db.query(`ALTER TABLE "pump_token" DROP CONSTRAINT "FK_826c7b5eb74ba7c53e25e5f8f61"`)
        //await db.query(`ALTER TABLE "token_created" DROP CONSTRAINT "FK_66966e206f5127105764cd3240c"`)
        //await db.query(`ALTER TABLE "trade" DROP CONSTRAINT "FK_1690d3192769d2b5dab9ba385fc"`)
        await db.query(`ALTER TABLE "token_completed" DROP CONSTRAINT "FK_5db49978b80fc779f35063867eb"`)
        await db.query(`ALTER TABLE "params_updated" DROP CONSTRAINT "FK_eb1ff8bacab59c47f7d9ce0e810"`)
    }
}
