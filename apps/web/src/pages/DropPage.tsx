import { useNavigate } from "react-router-dom";
import { DropZone } from "../components/DropZone.js";
import { api } from "../lib/api.js";

export function DropPage() {
  const navigate = useNavigate();

  return (
    <DropZone
      onDeploy={async (archive, onProgress) => {
        const deployment = await api.deploy(archive, onProgress);
        navigate(`/d/${deployment.id}`);
      }}
    />
  );
}
