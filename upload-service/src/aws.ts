import { S3 } from "aws-sdk";
import "dotenv/config";
import fs from "fs";

const s3 = new S3({
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || "",
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || "",
});

export const uploadFile = async (fileName: string, localFilePath: string) => {
    console.log("called");
    const key = fileName.replace(/\\/g, '/'); // replace \ with / (windows v unix)
    const fileContent = fs.readFileSync(localFilePath);
    const response = await s3.upload({
        Body: fileContent,
        Bucket: process.env.BUCKET || "",
        Key: key,
    }).promise();
    console.log(response);
}