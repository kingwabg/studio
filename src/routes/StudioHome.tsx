// StudioHome.tsx — 새 모듈형 스튜디오의 홈. 내 문서 목록 + 새 문서 생성.
// Radix Themes 컴포넌트로 구성 (검증된 디자인 시스템 — 품질을 손 취향에 안 맡긴다).
// 저장소는 repository(지금 localStorage, 나중에 Supabase) — 이 컴포넌트는 인터페이스만 안다.
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Badge,
  Box,
  Button,
  Card,
  Container,
  Flex,
  Grid,
  Heading,
  IconButton,
  Inset,
  Link as RLink,
  Text,
} from "@radix-ui/themes";
import { getRepository, type DocMeta } from "../modules/document/repository";
import { IcPlus, IcTrash, IcFile, IcLogo } from "../ui/icons";

const repo = getRepository();

export default function StudioHome() {
  const navigate = useNavigate();
  const [docs, setDocs] = useState<DocMeta[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    repo.list().then((list) => {
      setDocs(list);
      setLoading(false);
    });
  }, []);

  const startNew = async () => {
    const doc = await repo.create("제목 없는 문서");
    navigate(`/studio/editor/${doc.id}`);
  };

  const remove = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    await repo.remove(id);
    setDocs(await repo.list());
  };

  return (
    <Box style={{ minHeight: "100dvh", background: "var(--gray-2)" }}>
      {/* 헤더 */}
      <Flex
        align="center"
        px="6"
        style={{ height: 60, borderBottom: "1px solid var(--gray-a5)", background: "var(--color-background)" }}
      >
        <Flex align="center" gap="2">
          <Text style={{ color: "var(--accent-9)", display: "flex" }}>
            <IcLogo size={22} />
          </Text>
          <Heading size="4" weight="bold" style={{ letterSpacing: "-0.02em" }}>
            문서 스튜디오
          </Heading>
          <Badge color="indigo" variant="soft" radius="full">
            베타
          </Badge>
        </Flex>
        <RLink href="/" ml="auto" size="2" color="gray" highContrast={false}>
          기존 편집기 →
        </RLink>
      </Flex>

      <Container size="3" px="6" py="8">
        <Heading size="7" mb="1" style={{ letterSpacing: "-0.03em" }}>
          내 문서
        </Heading>
        <Text size="3" color="gray" as="p" mb="6">
          빈 캔버스에서 시작해 블록을 자유롭게 배치하세요. 작업은 자동 저장됩니다.
        </Text>

        <Grid columns={{ initial: "2", sm: "3", md: "4" }} gap="4">
          {/* 새 문서 카드 (클릭 가능한 Card = div, 내부에 중첩 버튼 없음) */}
          <Card size="2" variant="surface" onClick={startNew} className="click-card" style={{ cursor: "pointer" }}>
            <Flex direction="column" align="center" justify="center" gap="2" style={{ minHeight: 150 }}>
              <Flex
                align="center"
                justify="center"
                style={{ width: 44, height: 44, borderRadius: "var(--radius-5)", background: "var(--accent-3)", color: "var(--accent-11)" }}
              >
                <IcPlus size={22} />
              </Flex>
              <Text size="2" weight="medium">새 문서</Text>
              <Text size="1" color="gray">A4 · 자유 배치</Text>
            </Flex>
          </Card>

          {loading
            ? Array.from({ length: 3 }).map((_, i) => (
                <Card key={i} size="2">
                  <Box style={{ height: 150, opacity: 0.5 }} />
                </Card>
              ))
            : docs.map((d) => (
                <Card
                  key={d.id}
                  size="2"
                  variant="surface"
                  className="doc-card click-card"
                  onClick={() => navigate(`/studio/editor/${d.id}`)}
                  style={{ cursor: "pointer", position: "relative" }}
                >
                  <Inset side="top" pb="current">
                    <Flex
                      align="center"
                      justify="center"
                      style={{ height: 96, background: "var(--gray-3)", color: "var(--gray-8)" }}
                    >
                      <IcFile size={26} />
                    </Flex>
                  </Inset>
                  <Text as="div" size="2" weight="medium" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {d.title}
                  </Text>
                  <Text as="div" size="1" color="gray" mt="1">
                    {fmt(d.updatedAt)}
                  </Text>
                  <Box position="absolute" top="2" right="2" className="doc-del">
                    <IconButton
                      size="1"
                      variant="soft"
                      color="red"
                      radius="full"
                      aria-label="삭제"
                      onClick={(e) => remove(d.id, e)}
                    >
                      <IcTrash size={14} />
                    </IconButton>
                  </Box>
                </Card>
              ))}
        </Grid>

        {!loading && docs.length === 0 && (
          <Text size="2" color="gray" mt="5" as="p">
            아직 문서가 없어요. 새 문서로 시작해보세요.
          </Text>
        )}
      </Container>
    </Box>
  );
}

// 상대 시간 표기 (방금/N분 전/N시간 전/N일 전)
function fmt(ts: number): string {
  const diff = Date.now() - ts;
  const min = Math.floor(diff / 60000);
  if (min < 1) return "방금 수정";
  if (min < 60) return `${min}분 전 수정`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}시간 전 수정`;
  return `${Math.floor(hr / 24)}일 전 수정`;
}
