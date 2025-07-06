import { createClient } from "redis";
import { downloadS3Folder, copyFinalDist } from "./aws";
import { buildProject } from "./utils";

const subscriber = createClient();
subscriber.connect();

const publisher = createClient();
publisher.connect();

async function main() {
    while (true) {
        const res = await subscriber.brPop('build-queue', 0);
        console.log(res);
        if (res) {
            const id = res.element;
            try {
                await downloadS3Folder(`output/${id}`);
                await buildProject(id);
                copyFinalDist(id);
                await publisher.hSet("status", id, "deployed");
            } catch (err) {
                console.error(err);
                await publisher.hSet("status", id, "failed");
            }
        }
    }
}

main();