"use client";

import { useEffect, useState } from "react";

export function GitHubStars({
  repositoryUrl,
}: {
  repositoryUrl: string | null | undefined;
}) {
  const [stars, setStars] = useState<number | null>(null);

  useEffect(() => {
    if (!repositoryUrl) {
      setStars(0);
      return;
    }

    const match = repositoryUrl.match(/github\.com\/([^/]+)\/([^/]+)/);
    if (!match) {
      setStars(0);
      return;
    }

    const owner = match[1];
    const repo = match[2];
    if (!owner || !repo) {
      setStars(0);
      return;
    }
    const cleanRepo = repo.replace(/\.git$/, "").replace(/\/$/, "");

    fetch(`https://api.github.com/repos/${owner}/${cleanRepo}`)
      .then((res) => {
        if (!res.ok) throw new Error("Failed to fetch");
        return res.json();
      })
      .then((data) => {
        setStars(data.stargazers_count ?? 0);
      })
      .catch(() => {
        setStars(0);
      });
  }, [repositoryUrl]);

  return <>{stars !== null ? stars : 0}</>;
}
