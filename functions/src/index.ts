import * as functions from "firebase-functions";
import * as firebaseAdmin from "firebase-admin";
import * as request from "request";
import * as path from "path";
import * as fs from "fs";

import * as express from "express";
import * as cors from "cors";

const allDinosURL =
  "https://paleobiodb.org/data1.2/occs/list.json?base_name=Dinosauria&show=coords";
const tmpDinos = "/tmp/dinos.json";

let admin: firebaseAdmin.app.App;

export const collectData = functions
  .runWith({ secrets: ["SERVICE_ACCOUNT"] })
  .pubsub.schedule("every day 00:00")
  .onRun(async () => {
    if (!admin) {
      _initializeApp(process.env.SERVICE_ACCOUNT!);
    }

    await fs.exists("/tmp", (exists) => {
      if (!exists) {
        fs.mkdir("/tmp", () => {
          console.log("Successfully created tmp.");
        });
      }
    });

    const output = path.resolve(tmpDinos);
    const outputStream = fs.createWriteStream(output);

    await new Promise<void>((resolve) =>
      request(allDinosURL, async (error) => {
        if (error) {
          console.error(error);
        } else {
          console.log("Successfully downloaded dinos.json!");
          resolve();
        }
      }).pipe(outputStream)
    );

    const rawData = fs.readFileSync(tmpDinos);
    const parsedData = JSON.parse(rawData.toString("utf-8"));

    const cleanedData = parsedData.records.map((dino: any) => ({
      oid: dino.oid,
      lat: dino.lat,
      lng: dino.lng,
    }));

    await fs.writeFileSync(tmpDinos, JSON.stringify(cleanedData));

    await admin
      .storage()
      .bucket()
      .upload(tmpDinos)
      .then(async () => {
        console.log("Upload successfull!");
        await fs.exists(tmpDinos, async (exists) => {
          if (exists) {
            try {
              await fs.unlink(tmpDinos, (error) => {
                if (error) {
                  console.error(error);
                }
              });
            } catch (e) {
              console.error(e);
            }
          }
        });
      });
  });

const endpoints = express();

endpoints.use(cors({ origin: true }));

endpoints.get("/dinos", async (request, response) => {
  if (!admin) {
    _initializeApp(process.env.SERVICE_ACCOUNT!);
  }

  response.set("Chached-Control", "public, max-age=300, s-maxage=600");
  response.set("Access-Control-Allow-Origin", "*");
  try {
    await fs.exists("/tmp", (exists) => {
      if (!exists) {
        fs.mkdir("/tmp", () => {
          console.log("Successfully created tmp.");
        });
      }
    });
    const fileName = tmpDinos;
    const file = await firebaseAdmin.storage().bucket().file("dinos.json");
    await new Promise<void>((resolve) =>
      file
        .createReadStream()
        .on("error", function (err) {
          console.error(err);
        })
        .on("end", function () {
          resolve();
        })
        .pipe(fs.createWriteStream(fileName))
    );
    const dinos = await new Promise<void>((resolve) =>
      fs.readFile(fileName, undefined, async (error, data) => {
        if (error) {
          console.error(error);
        } else {
          await fs.unlinkSync(fileName);
          resolve(JSON.parse(data.toString()));
        }
      })
    );
    response.json(dinos);
  } catch (error) {
    console.error(error);
  }
});

export const api = functions
  .runWith({ memory: "8GB", timeoutSeconds: 540, secrets: ["SERVICE_ACCOUNT"] })
  .https.onRequest(endpoints);

function _initializeApp(secret: string): void {
  admin = firebaseAdmin.initializeApp({
    credential: firebaseAdmin.credential.cert(JSON.parse(secret)),
    storageBucket: "gs://dino-finder-362009.appspot.com",
  });
}
