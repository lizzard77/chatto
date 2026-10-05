<script lang="ts">
  import { page } from '$app/state';
  import { m } from '$lib/i18n/messages';
  import { sidebarLinkTarget } from '$lib/navigation/sidebarLinkTarget';
  import { stripSidebarLinkEmbed } from '$lib/navigation/sidebarLinkEmbed';
  import { serverRegistry } from '$lib/client';
  import { useServerScope } from '$lib/state/server/scope.svelte';
  import { serverUi } from '$lib/state/server/serverUi';
  import EmptyState from '$lib/ui/EmptyState.svelte';
  import PageTitle from '$lib/ui/PageTitle.svelte';
  import PaneHeader from '$lib/ui/PaneHeader.svelte';

  const serverScope = useServerScope();
  const navigation = $derived(serverUi(serverScope.store).navigation);
  const serverBaseURL = $derived(serverRegistry.getServer(serverScope.serverId)?.url ?? null);

  const link = $derived.by(() => {
    for (const group of navigation.roomGroups) {
      for (const item of group.items ?? []) {
        if (item.type === 'link' && item.link.id === page.params.linkId) return item.link;
      }
    }
    return null;
  });

  const target = $derived(
    link ? sidebarLinkTarget(stripSidebarLinkEmbed(link.url), serverBaseURL) : null
  );
</script>

<PageTitle title={link?.label ?? m('admin.rooms_admin.embed_not_found')} />

<div class="pane-page">
  <PaneHeader title={link?.label ?? ''}>
    {#snippet actions()}
      {#if target?.valid}
        <a
          href={target.href}
          target="_blank"
          rel="noopener noreferrer"
          class="pane-header-icon-button text-muted"
          title={m('admin.rooms_admin.embed_open_in_tab')}
          aria-label={m('admin.rooms_admin.embed_open_in_tab')}
        >
          <span class="pane-header-icon-glyph text-base icon-[uil--external-link-alt]" aria-hidden="true"
          ></span>
        </a>
      {/if}
    {/snippet}
  </PaneHeader>

  {#if target?.valid}
    {#key target.href}
      <iframe
        src={target.href}
        title={link?.label}
        class="min-h-0 w-full flex-1 border-0 bg-white"
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-downloads allow-modals"
        referrerpolicy="strict-origin-when-cross-origin"
        allow="clipboard-write; fullscreen"
      ></iframe>
    {/key}
  {:else if navigation.roomGroups.length > 0}
    <EmptyState title={m('admin.rooms_admin.embed_not_found')} />
  {/if}
</div>
