# Migrating from GitBook

{% hint style="warning" %}
Check your **links** after importing.
{% endhint %}

{% hint style="success" %}
Nested content works too:

* one
* two
{% endhint %}

{% tabs %}
{% tab title="npm" %}
```bash
npm install
```
{% endtab %}

{% tab title="pnpm" %}
```bash
pnpm install
```
{% endtab %}
{% endtabs %}

{% code title="config.ts" %}
```ts
export const mode = "git";
```
{% endcode %}

{% stepper %}
{% step %}
### Connect the repository
Paste the URL.
{% endstep %}
{% step %}
### Choose a branch
Usually `main`.
{% endstep %}
{% endstepper %}

{% file src="files/export.zip" %}

{% embed url="https://www.youtube.com/watch?v=dQw4w9WgXcQ" %}

{% content-ref url="concepts.md" %}
[Concepts](concepts.md)
{% endcontent-ref %}

{% mystery %}

Text after the unknown tag.
